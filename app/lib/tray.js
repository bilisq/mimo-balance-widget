'use strict';

/**
 * 托盘：窗口隐藏后唯一的入口。
 * 图标缺失时用内置的橙色小圆点兜底，避免出现"看不见的空托盘"。
 */

const FALLBACK_ICON =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAtklEQVR42tWXuw3AIAxEaViCKdiHCbIIU7AbU1ATF06TCAECcw7SayKiM/iDbczfVr2MIwIRicRE/uakRC2LFKJ2KLzX7hKPA6It4upV5wXxhzztGvrBbxB+42dOXoVwIwZkQQOyZMCtBSanWj2ERZ2+fQuDRWYX5WTk9zOC6/hpAwLK/9844BfttAFJlQFwF8CDEJuG8EKkpRRjHyP4c6yiIVHRksGbUhVtuYrBRM1opmI4lVw3XMWKM/cGL48AAAAASUVORK5CYII=';

function loadIcon(nativeImage, file) {
  try {
    const image = nativeImage.createFromPath(file);
    if (!image.isEmpty()) return image.resize({ width: 32, height: 32 });
  } catch {
    /* 忽略，用兜底图标 */
  }
  return nativeImage.createFromBuffer(Buffer.from(FALLBACK_ICON, 'base64')).resize({ width: 32, height: 32 });
}

/**
 * @param {{
 *   Tray: any, Menu: any, nativeImage: any,
 *   iconPath: string,
 *   isVisible: () => boolean,
 *   onToggle: () => void, onRefresh: () => void, onSettings: () => void,
 *   onOpenDataDir: () => void, onOpenLog: () => void, onQuit: () => void
 * }} options
 */
function createTray(options) {
  const tray = new options.Tray(loadIcon(options.nativeImage, options.iconPath));
  tray.setToolTip('MiMo 余额挂件');

  const rebuild = () => {
    tray.setContextMenu(
      options.Menu.buildFromTemplate([
        {
          label: options.isVisible() ? '隐藏桌宠' : '显示桌宠',
          click: () => {
            options.onToggle();
            rebuild();
          },
        },
        { label: '立即刷新', click: () => options.onRefresh() },
        { type: 'separator' },
        { label: '设置…', click: () => options.onSettings() },
        { label: '打开数据目录', click: () => options.onOpenDataDir() },
        { label: '查看日志', click: () => options.onOpenLog() },
        { type: 'separator' },
        { label: '退出', click: () => options.onQuit() },
      ])
    );
  };

  rebuild();
  tray.on('click', () => {
    options.onToggle();
    rebuild();
  });

  return { tray, rebuild };
}

module.exports = { createTray };
