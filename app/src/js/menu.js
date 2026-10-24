/**
 * 设置面板：所有可调项的读写都集中在这里。
 *
 * 写入统一走 `persist()`：串行化 + 失败不打断界面。控件的事件只负责
 * 收集值，不直接改状态——状态由主进程返回的完整 settings 覆盖。
 */

import { $, $$, clear, el, on, setText } from './dom.js';
import { stamp } from '../../shared/format.js';
import { applyScale } from './theme.js';

export function createMenu({ api, pet, toast, diagnostics, getSettings, getTheme, getSnapshot, onChange, onThemeChanged, onRefreshData, onOpenChange }) {
  const root = $('#menu');
  const scale = $('#scale');
  const scaleValue = $('#scale-value');
  const themeSelect = $('#theme-select');
  const imageName = $('#image-name');
  const pickImage = $('#pick-image');
  const resetImage = $('#reset-image');
  const imageFile = $('#image-file');
  const speechEnabled = $('#speech-enabled');
  const speechLines = $('#speech-lines');
  const toastFollow = $('#toast-follow');
  const toastText = $('#toast-text');
  const toastFill = $('#toast-fill');
  const toastStroke = $('#toast-stroke');
  const cookie = $('#cookie');
  const saveCookie = $('#save-cookie');
  const cookieStatus = $('#cookie-status');
  const openConsole = $('#open-console');
  const sessionList = $('#session-list');
  const pinSession = $('#pin-session');
  const followLatest = $('#follow-latest');
  const sessionHint = $('#session-hint');
  const warn = $('#warn');
  const saveWarn = $('#save-warn');
  const warnFollow = $('#warn-follow');
  const warnHint = $('#warn-hint');
  const autostartEnable = $('#autostart-enable');
  const autostartDisable = $('#autostart-disable');
  const autostartHint = $('#autostart-hint');
  const openData = $('#open-data');
  const openLogs = $('#open-logs');
  const openDiagnostics = $('#open-diagnostics');
  const checkUpdate = $('#check-update');
  const quit = $('#quit');
  const version = $('#version');

  let opened = false;
  let queue = Promise.resolve();

  const settings = () => getSettings();

  function hint(node, text, kind = '') {
    setText(node, text);
    if (node) node.className = `hint${kind ? ` is-${kind}` : ''}`;
  }

  function persist(patch) {
    queue = queue
      .then(() => api.settings.save(patch))
      .then((next) => {
        onChange(next);
        return next;
      })
      .catch((error) => {
        // 保存失败不该打断操作；日志由主进程统一写，这里只在控制台留痕
        // eslint-disable-next-line no-console
        console.error('[menu] 保存设置失败', error);
        return settings();
      });
    return queue;
  }

  function readColors() {
    return {
      text: toastText.value,
      fill: toastFill.value,
      stroke: toastStroke.value,
    };
  }

  function readDisplay() {
    const display = {};
    for (const box of $$('[data-opt]', root)) display[box.dataset.opt] = box.checked;
    return display;
  }

  function currentDisplay() {
    const source = settings().display || {};
    const display = {};
    for (const box of $$('[data-opt]', root)) display[box.dataset.opt] = source[box.dataset.opt] !== false;
    return display;
  }

  function setActivePreset(presetId) {
    for (const button of $$('.preset', root)) {
      button.classList.toggle('is-active', button.dataset.preset === presetId);
    }
  }

  function syncColors() {
    const custom = settings().toastMode === 'custom';
    toastFollow.checked = !custom;
    for (const input of [toastText, toastFill, toastStroke]) input.disabled = !custom;
    if (custom && settings().toastColors) {
      toastText.value = settings().toastColors.text;
      toastFill.value = settings().toastColors.fill;
      toastStroke.value = settings().toastColors.stroke;
    }
  }

  function syncWarnHint() {
    const value = settings().balanceWarn;
    if (value === null || value === undefined) {
      const official = getSnapshot() && getSnapshot().alertConfig;
      const threshold = official && official.ok && official.threshold !== null ? official.threshold : null;
      hint(warnHint, threshold === null ? '当前跟随官方阈值（未取到，默认 ¥5）' : `当前跟随官方阈值：¥${threshold}`);
    } else {
      hint(warnHint, `当前自定义：低于 ¥${value} 时余额变红`);
    }
  }

  async function loadSessions() {
    if (!sessionList) return;
    clear(sessionList);
    try {
      const data = await api.sessions.list();
      for (const item of data.sessions || []) {
        sessionList.append(
          el('option', {
            value: item.id,
            text: `${String(item.title || '').slice(0, 18)} · ${stamp(item.time)}`,
          })
        );
      }
      if (settings().sessionId) sessionList.value = settings().sessionId;
      hint(sessionHint, settings().sessionId ? `已锁定：${settings().sessionId}` : '未锁定：自动取最新会话');
    } catch (error) {
      hint(sessionHint, `无法读取会话列表：${error.message || error}`, 'error');
    }
  }

  async function loadAutostart() {
    try {
      const status = await api.autostart.get();
      hint(autostartHint, status.enabled ? `已开启${status.target ? ` → ${status.target}` : ''}` : '未开启（仅 Windows 支持）');
    } catch (error) {
      hint(autostartHint, error.message || String(error), 'error');
    }
  }

  async function loadVersion() {
    try {
      const info = await api.info();
      setText(version, `v${info.version} · Electron ${info.electron} · ${info.dataDir}`);
    } catch {
      setText(version, '');
    }
  }

  /** 用最新 settings 刷一遍控件（不触发事件）。 */
  function sync() {
    const current = settings();
    if (!current) return;

    // 正在输入的控件不要被外部更新覆盖（否则保存别的设置时会把没提交的内容冲掉）
    const setInput = (node, value) => {
      if (node && document.activeElement !== node) node.value = value;
    };

    const pct = Math.round((current.scale || 1) * 100);
    setInput(scale, String(pct));
    setText(scaleValue, `${pct}%`);
    if (themeSelect) themeSelect.value = current.theme;
    if (speechEnabled) speechEnabled.checked = current.speechEnabled;
    setInput(speechLines, (current.speechLines || []).join('\n'));

    setActivePreset(current.customImage ? null : current.presetId);
    setText(imageName, current.customImage ? `当前：自定义（${current.customImage.split(/[\\/]/).pop()}）` : `当前：${labelOf(current.presetId)}`);

    for (const box of $$('[data-opt]', root)) {
      const display = currentDisplay();
      box.checked = display[box.dataset.opt] !== false;
    }

    syncColors();
    syncWarnHint();
    if (warn) {
      const nextWarn = current.balanceWarn === null || current.balanceWarn === undefined ? '' : String(current.balanceWarn);
      if (document.activeElement !== warn) warn.value = nextWarn;
    }
    if (cookieStatus && opened) hint(cookieStatus, '');
  }

  function labelOf(presetId) {
    const button = root && root.querySelector(`.preset[data-preset="${presetId}"]`);
    return button ? button.textContent.trim() : '小米姬';
  }

  // ------------------------------------------------------------ 事件绑定

  if (root) {
    const close = $('#menu-close');
    on(close, 'click', () => closeMenu());

    on(scale, 'input', () => {
      const pct = Number(scale.value);
      setText(scaleValue, `${pct}%`);
      applyScale(pct / 100);
    });
    on(scale, 'change', () => persist({ scale: Number(scale.value) / 100 }));

    on(themeSelect, 'change', () => {
      persist({ theme: themeSelect.value }).then(() => {
        if (onThemeChanged) onThemeChanged();
      });
    });

    for (const button of $$('.preset', root)) {
      on(button, 'click', (event) => {
        event.stopPropagation();
        const presetId = button.dataset.preset;
        persist({ presetId, customImage: null }).then(() => {
          pet.usePreset(presetId, getTheme().dark);
          setActivePreset(presetId);
          setText(imageName, `当前：${button.textContent.trim()}`);
        });
      });
    }

    on(pickImage, 'click', () => imageFile.click());
    on(imageFile, 'change', async () => {
      const file = imageFile.files && imageFile.files[0];
      if (!file) return;
      setText(imageName, '处理中…');
      try {
        const buffer = await file.arrayBuffer();
        const result = await api.petImage.save({ buffer, name: file.name });
        if (!result.ok) throw new Error((result.error && result.error.message) || '保存失败');
        pet.useCustom(result.dataUrl);
        setActivePreset(null);
        setText(imageName, `当前：${file.name}`);
        onChange(await api.settings.get());
      } catch (error) {
        setText(imageName, `失败：${error.message || error}`);
      }
      imageFile.value = '';
    });

    on(resetImage, 'click', async () => {
      await api.petImage.reset();
      const next = await api.settings.get();
      onChange(next);
      pet.usePreset(next.presetId, getTheme().dark);
      setActivePreset(next.presetId);
      setText(imageName, `当前：${labelOf(next.presetId)}`);
    });

    on(speechEnabled, 'change', () => persist({ speechEnabled: speechEnabled.checked }));
    on(speechLines, 'change', () => persist({ speechLines: speechLines.value.split(/\r?\n/) }));

    on(toastFollow, 'change', () => {
      const mode = toastFollow.checked ? 'auto' : 'custom';
      for (const input of [toastText, toastFill, toastStroke]) input.disabled = mode === 'auto';
      persist({ toastMode: mode, toastColors: readColors() });
    });

    let colorTimer = null;
    for (const input of [toastText, toastFill, toastStroke]) {
      on(input, 'input', () => {
        if (colorTimer) clearTimeout(colorTimer);
        colorTimer = setTimeout(() => persist({ toastMode: 'custom', toastColors: readColors() }), 250);
      });
    }

    for (const box of $$('[data-opt]', root)) {
      on(box, 'change', () => persist({ display: readDisplay() }));
    }

    on(saveCookie, 'click', async () => {
      const value = cookie.value.trim();
      if (!value) {
        hint(cookieStatus, '请先粘贴 Cookie', 'error');
        return;
      }
      hint(cookieStatus, '保存中…');
      const result = await api.cookie.save(value);
      if (!result || !result.ok) {
        hint(cookieStatus, (result && result.error && result.error.message) || '保存失败', 'error');
        return;
      }
      cookie.value = '';
      if (result.encrypted) {
        hint(cookieStatus, '已加密保存（DPAPI，仅本机当前用户可解），正在刷新…', 'ok');
      } else {
        hint(cookieStatus, '已保存，但是明文存储：换机或拷贝目录前请删除 config.json', 'error');
      }

      // 刷新结束后必须把这行改掉：否则界面永远停在"正在刷新…"，
      // 用户无法判断到底是成功了、失败了、还是卡住了。
      const payload = await onRefreshData();
      if (payload && payload.ok !== false) {
        const when = payload.generatedAt ? new Date(payload.generatedAt) : new Date();
        const time = Number.isNaN(when.getTime())
          ? ''
          : `（${when.toLocaleTimeString('zh-CN', { hour12: false })}）`;
        const cacheNote = payload.source === 'cache' ? '，当前显示缓存数据' : '';
        hint(cookieStatus, `刷新完成${time}${cacheNote}`, 'ok');
      } else {
        const message = (payload && payload.error && payload.error.message) || '刷新失败';
        hint(cookieStatus, `${message}（会按刷新间隔自动重试）`, 'error');
      }
    });

    on(openConsole, 'click', () => api.open('console'));

    on(pinSession, 'click', async () => {
      const id = sessionList.value;
      if (!id) return;
      const result = await api.sessions.pin(id);
      if (result && result.ok) {
        onChange(result.settings);
        hint(sessionHint, `已锁定：${id}`, 'ok');
      }
    });

    on(followLatest, 'click', async () => {
      const result = await api.sessions.pin(null);
      if (result && result.ok) {
        onChange(result.settings);
        hint(sessionHint, '未锁定：自动取最新会话', 'ok');
      }
    });

    on(saveWarn, 'click', () => {
      const value = Number(warn.value);
      if (!Number.isFinite(value) || value < 0) {
        hint(warnHint, '请输入有效金额', 'error');
        return;
      }
      persist({ balanceWarn: value }).then(() => hint(warnHint, `已保存：低于 ¥${value} 时变红`, 'ok'));
    });

    on(warnFollow, 'click', () => {
      warn.value = '';
      persist({ balanceWarn: null }).then(() => syncWarnHint());
    });

    on(autostartEnable, 'click', async () => {
      const result = await api.autostart.set(true);
      if (result && result.ok) hint(autostartHint, '已开启开机自启', 'ok');
      else hint(autostartHint, (result && result.message) || '设置失败', 'error');
    });

    on(autostartDisable, 'click', async () => {
      const result = await api.autostart.set(false);
      if (result && result.ok) hint(autostartHint, '已取消开机自启', 'ok');
      else hint(autostartHint, (result && result.message) || '取消失败', 'error');
    });

    on(openData, 'click', () => api.open('data'));
    on(openLogs, 'click', () => api.open('logs'));
    on(openDiagnostics, 'click', () => {
      closeMenu();
      diagnostics.open();
    });

    // 手动检查更新：不后台轮询、不上报，只有点了才发一次 GitHub API 请求
    on(checkUpdate, 'click', async () => {
      hint(version, '检查中…');
      try {
        const result = await api.update.check();
        if (!result || !result.ok) {
          hint(version, (result && result.message) || '检查失败', 'error');
          return;
        }
        if (result.hasUpdate) {
          hint(version, `发现 ${result.latestVersion}（当前 ${result.currentVersion}），正在打开发布页…`, 'ok');
          await api.open('releases');
        } else {
          hint(version, `已是最新版本（${result.currentVersion}）`, 'ok');
        }
      } catch (error) {
        hint(version, error.message || String(error), 'error');
      }
    });

    on(quit, 'click', () => api.quit());
  }

  function openMenu() {
    if (!root) return;
    opened = true;
    root.hidden = false;
    toast.hideAll();
    sync();
    if (onOpenChange) onOpenChange(true);
    void loadSessions();
    void loadAutostart();
    void loadVersion();
  }

  function closeMenu() {
    if (!root) return;
    opened = false;
    root.hidden = true;
    if (onOpenChange) onOpenChange(false);
  }

  return {
    open: openMenu,
    close: closeMenu,
    toggle: () => (opened ? closeMenu() : openMenu()),
    isOpen: () => opened,
    sync,
    element: root,
  };
}
