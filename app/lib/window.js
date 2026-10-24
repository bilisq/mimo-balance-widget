'use strict';

/**
 * 窗口与几何：创建、贴边吸附、位置持久化。
 *
 * 窗口固定 430×430 全透明，宠物画在右下角；气泡和菜单都画在同一个窗口
 * 里向左/向上展开。这样拖拽、吸附只需要换算一次坐标，不必动态改窗口大小。
 */

const path = require('node:path');

class WindowController {
  constructor({ BrowserWindow, screen, paths, geometry, logger, onMoved, onRendererError }) {
    this.BrowserWindow = BrowserWindow;
    this.screen = screen;
    this.paths = paths;
    this.geometry = geometry;
    this.logger = logger;
    this.onMoved = onMoved;
    this.onRendererError = onRendererError;

    this.win = null;
    this.saveTimer = null;
    this.bounds = null;
  }

  create({ show = true } = {}) {
    const { WINDOW } = this.geometry;
    this.win = new this.BrowserWindow({
      width: WINDOW.width,
      height: WINDOW.height,
      frame: false,
      transparent: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      focusable: true,
      show: false,
      title: 'MiMo 余额挂件',
      icon: path.join(this.paths.assetsDir, 'whale-tight.png'),
      webPreferences: {
        preload: this.paths.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        backgroundThrottling: false,
      },
    });

    // 'floating' 而非 'screen-saver'：只在普通窗口之上，不压全屏游戏/视频
    this.win.setAlwaysOnTop(true, 'floating');
    this.win.setMenuBarVisibility(false);

    this.win.webContents.on('render-process-gone', (_event, details) => {
      this.logger.error('renderer.gone', details);
    });
    // Electron 37 的签名是 (event, level, message)；level 2=warning 3=error。
    // 我们显式锁定了 electron 37.10.3，所以不再写"兼容新版"的分支——
    // 那类代码只有在版本漂移时才生效，平时只会增加阅读负担。
    // 将来升级 Electron 时，这里要改成读 event.level / event.message。
    this.win.webContents.on('console-message', (_event, level, message) => {
      if ((level === 2 || level === 3) && message) this.logger.warn('renderer.console', message);
    });
    if (this.onRendererError) this.onRendererError(this.win);

    this.win.on('moved', () => this._schedulePersist());

    this.win.once('ready-to-show', () => {
      if (show) this.win.show();
    });

    // 兜底：透明窗口在某些显卡/驱动组合下 ready-to-show 可能永远不触发，
    // 表现就是"双击了没反应"。页面加载完还不可见就强制显示一次，
    // 至少让用户看到窗口（哪怕内容有问题），而不是无声无息。
    if (show) {
      this.win.webContents.once('did-finish-load', () => {
        setTimeout(() => {
          if (!this.win || this.win.isVisible()) return;
          this.logger.warn('window.show-fallback', 'ready-to-show 未触发，强制显示窗口');
          this.win.show();
        }, 1500);
      });
    }

    this.win.on('closed', () => {
      this.win = null;
    });

    this.win.loadFile(this.paths.indexHtml);
    return this.win;
  }

  get webContents() {
    return this.win && !this.win.isDestroyed() ? this.win.webContents : null;
  }

  send(channel, payload) {
    const contents = this.webContents;
    if (contents) contents.send(channel, payload);
  }

  /** 窗口被意外销毁后重建（托盘常驻，不能让窗口消失就失联）。 */
  recreate({ show = true } = {}) {
    if (this.win && !this.win.isDestroyed()) return this.win;
    this.logger.warn('window.recreate', '窗口已不存在，按托盘请求重建');
    return this.create({ show });
  }

  show() {
    if (!this.win) this.recreate();
    if (!this.win) return;
    if (this.win.isMinimized()) this.win.restore();
    this.win.show();
    this.win.focus();
  }

  hide() {
    if (this.win) this.win.hide();
  }

  toggle() {
    if (!this.win) {
      this.recreate();
      return;
    }
    if (this.win.isVisible()) this.hide();
    else this.show();
  }

  isVisible() {
    return !!this.win && this.win.isVisible();
  }

  getBounds() {
    if (!this.win) return null;
    return this.win.getBounds();
  }

  /**
   * 恢复位置：优先用上次拖到的位置；不在任何显示器上就回到右下角。
   * @param {{x: number, y: number}|null} saved
   */
  restorePosition(saved) {
    if (!this.win) return;
    if (saved && this._isOnScreen(saved)) {
      this.win.setPosition(Math.round(saved.x), Math.round(saved.y));
      return;
    }
    this.placeBottomRight();
  }

  _isOnScreen(point) {
    const { PET } = this.geometry;
    const displays = this.screen.getAllDisplays();
    return displays.some((display) => {
      const area = display.workArea;
      const left = point.x + this.geometry.WINDOW.width - PET.width;
      const top = point.y + this.geometry.WINDOW.height - PET.height;
      const overlapX = Math.min(left + PET.width, area.x + area.width) - Math.max(left, area.x);
      const overlapY = Math.min(top + PET.height, area.y + area.height) - Math.max(top, area.y);
      return overlapX > 40 && overlapY > 40;
    });
  }

  /** 让宠物贴在屏幕右下角。 */
  placeBottomRight() {
    if (!this.win) return;
    const { PET, WINDOW } = this.geometry;
    const margin = WINDOW.margin;
    const area = this.screen.getPrimaryDisplay().workArea;
    const left = area.x + area.width - margin - PET.width;
    const top = area.y + area.height - margin - PET.height;
    this.win.setPosition(Math.round(left - (WINDOW.width - PET.width)), Math.round(top - (WINDOW.height - PET.height)));
  }

  /** 拖拽结束：吸附到最近的屏幕边缘（按宠物矩形算，不是窗口矩形）。 */
  snapToEdge() {
    if (!this.win) return;
    const { PET, WINDOW } = this.geometry;
    const margin = WINDOW.margin;
    const bounds = this.win.getBounds();
    const area = this.screen.getDisplayMatching(bounds).workArea;

    const insetX = WINDOW.width - PET.width;
    const insetY = WINDOW.height - PET.height;
    const petLeft = bounds.x + insetX;
    const petTop = bounds.y + insetY;

    const distanceLeft = petLeft - area.x;
    const distanceRight = area.x + area.width - (petLeft + PET.width);
    const distanceTop = petTop - area.y;
    const distanceBottom = area.y + area.height - (petTop + PET.height);

    const targetLeft = Math.abs(distanceLeft) <= Math.abs(distanceRight)
      ? area.x + margin
      : area.x + area.width - margin - PET.width;
    const targetTop = Math.abs(distanceTop) <= Math.abs(distanceBottom)
      ? area.y + margin
      : area.y + area.height - margin - PET.height;

    this.win.setPosition(Math.round(targetLeft - insetX), Math.round(targetTop - insetY));
    this._schedulePersist();
  }

  /** 拖动时保证宠物还在屏幕内，避免"拖丢了找不回来"。 */
  moveTo(point) {
    if (!this.win || !point) return;
    const { PET, WINDOW } = this.geometry;
    const area = this.screen.getDisplayNearestPoint({
      x: Math.round(point.x + WINDOW.width - PET.width),
      y: Math.round(point.y + WINDOW.height - PET.height),
    }).workArea;

    // 宠物固定在窗口右下角，所以约束要换算成"宠物矩形至少露出 minVisible 像素"
    const minVisible = 48;
    const insetX = WINDOW.width - PET.width;
    const insetY = WINDOW.height - PET.height;
    const minX = area.x + minVisible - WINDOW.width;
    const maxX = area.x + area.width - minVisible - insetX;
    const minY = area.y + minVisible - WINDOW.height;
    const maxY = area.y + area.height - minVisible - insetY;

    const x = Math.round(Math.min(Math.max(point.x, minX), maxX));
    const y = Math.round(Math.min(Math.max(point.y, minY), maxY));
    this.win.setPosition(x, y);
  }

  _schedulePersist() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (!this.win) return;
      const bounds = this.win.getBounds();
      if (this.onMoved) this.onMoved({ x: bounds.x, y: bounds.y });
    }, 500);
  }

  onDisplaysChanged() {
    if (!this.win) return;
    const bounds = this.win.getBounds();
    if (!this._isOnScreen(bounds)) this.placeBottomRight();
  }
}

module.exports = { WindowController };
