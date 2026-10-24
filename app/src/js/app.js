/**
 * 渲染层入口：装配各模块 + 订阅主进程事件。
 *
 * 状态只有一份（ctx），所有模块都通过回调读写它，避免各模块各自缓存
 * settings / snapshot 导致界面不一致。
 */

import { PET } from '../../shared/geometry.js';
import { api, available } from './api.js';
import { $, on } from './dom.js';
import { applyPreset, applyScale, applyTheme } from './theme.js';
import { createAudio } from './audio.js';
import { createToast } from './toast.js';
import { createPanel } from './panel.js';
import { createPet } from './pet.js';
import { createMenu } from './menu.js';
import { createDiagnostics } from './diagnostics.js';
import { createIdleSpeech } from './idle.js';

const ctx = {
  settings: null,
  theme: { dark: false },
  snapshot: null,
  sidecar: null,
  pendingKey: '',
  lastTurnSeen: 0,
  booted: false,
};

async function boot() {
  document.documentElement.style.setProperty('--pet-w', `${PET.width}px`);
  document.documentElement.style.setProperty('--pet-h', `${PET.height}px`);

  if (!available) {
    // 直接用浏览器打开 index.html 时的兜底提示
    document.body.dataset.ready = '2';
    const panel = $('#panel');
    if (panel) panel.hidden = false;
    const status = $('#status');
    if (status) status.textContent = '请用 npm start 启动（浏览器直开拿不到数据）';
    return;
  }

  const audio = createAudio();
  const toast = createToast();
  const diagnostics = createDiagnostics({ api });

  let panel = null;
  let menu = null;

  const pet = createPet({
    api,
    audio,
    onActivate: () => (menu && menu.isOpen() ? menu.close() : panel.toggle()),
    onContextMenu: () => (menu && menu.isOpen() ? menu.close() : menu.open()),
  });

  panel = createPanel({
    api,
    onOpen: () => {
      if (menu && menu.isOpen()) menu.close();
      toast.hide('idle');
    },
  });

  async function refreshTheme() {
    try {
      ctx.theme = (await api.theme.get()) || { dark: false };
    } catch {
      ctx.theme = { dark: false };
    }
    applyTheme(ctx.theme, ctx.settings);
    if (ctx.settings && !ctx.settings.customImage) pet.usePreset(ctx.settings.presetId, ctx.theme.dark);
    return ctx.theme;
  }

  function applySettings(settings) {
    if (!settings) return;
    ctx.settings = settings;
    applyScale(settings.scale);
    applyPreset(settings.presetId);
    if (menu) menu.sync(settings);
    panel.setSettings(settings);
    applyTheme(ctx.theme, settings);
  }

  menu = createMenu({
    api,
    pet,
    toast,
    diagnostics,
    getSettings: () => ctx.settings,
    getTheme: () => ctx.theme,
    getSnapshot: () => ctx.snapshot,
    onChange: applySettings,
    onThemeChanged: refreshTheme,
    onRefreshData: () => refreshData(),
    onOpenChange: (open) => {
      const root = $('#pet');
      if (root) root.classList.toggle('is-menu-open', open);
    },
  });

  // 桌宠右上角的 ☰ 按钮：之前只有样式、没有事件，点了完全没反应。
  // 这里接上"打开/关闭设置面板"，并阻止冒泡，避免同时触发桌宠的点击逻辑。
  on($('#menu-button'), 'click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (menu.isOpen()) menu.close();
    else menu.open();
  });

  // ---------------------------------------------------------- 数据

  function renderSnapshot(payload) {
    if (!payload) return;
    ctx.snapshot = payload;
    panel.render(payload);
    maybeTurnToast(payload);
  }

  function maybeTurnToast(payload) {
    const turn = payload.lastTurn;
    if (!turn || !turn.ok) return;
    const ended = Number(turn.endedAt || 0);
    if (!ctx.booted) {
      ctx.lastTurnSeen = ended;
      return;
    }
    if (ended > ctx.lastTurnSeen) {
      ctx.lastTurnSeen = ended;
      if (!menu.isOpen()) toast.showTurn(turn);
    }
  }

  async function refreshData() {
    panel.setStatus('刷新中…');
    try {
      const payload = await api.data.refresh();
      if (payload && payload.ok === false) {
        panel.setStatus((payload.error && payload.error.message) || '刷新失败', 'error');
      } else if (payload) {
        // 主进程也会推 snapshot 事件，这里直接渲染一次，避免竞态导致界面不更新
        renderSnapshot(payload);
      }
      return payload;
    } catch (error) {
      panel.setStatus(error.message || String(error), 'error');
      return null;
    }
  }

  function handleProbe(probe) {
    if (!probe) return;
    const pending = probe.pending;
    if (pending && pending.kind) {
      const key = `${pending.kind}|${pending.message || ''}`;
      if (key !== ctx.pendingKey) {
        ctx.pendingKey = key;
        toast.showPending(pending.message, pending.kind);
      }
      return;
    }
    if (ctx.pendingKey) {
      ctx.pendingKey = '';
      toast.hide('pending');
    }
  }

  function handleStatus(status) {
    if (!status) return;
    ctx.sidecar = status.sidecar;
    const sidecarState = status.sidecar && status.sidecar.state;
    if (sidecarState && sidecarState !== 'ready') {
      const message = (status.sidecar.error || '数据服务未就绪').toString();
      panel.setStatus(`${message}（运行 setup.cmd 可修复）`, 'error');
    }
  }

  // ---------------------------------------------------------- 初始化

  ctx.settings = await api.settings.get();
  ctx.theme = (await api.theme.get()) || { dark: false };

  applyTheme(ctx.theme, ctx.settings);
  applyScale(ctx.settings.scale);
  applyPreset(ctx.settings.presetId);
  pet.usePreset(ctx.settings.presetId, ctx.theme.dark);

  try {
    const image = await api.petImage.get();
    if (image && image.dataUrl) pet.useCustom(image.dataUrl);
  } catch {
    /* 自定义图读取失败就继续用预设 */
  }

  menu.sync(ctx.settings);
  panel.setSettings(ctx.settings);

  api.on.snapshot(renderSnapshot);
  api.on.probe(handleProbe);
  api.on.theme((theme) => {
    ctx.theme = theme || ctx.theme;
    applyTheme(ctx.theme, ctx.settings);
    if (ctx.settings && !ctx.settings.customImage) pet.usePreset(ctx.settings.presetId, ctx.theme.dark);
  });
  api.on.status(handleStatus);
  api.on.settings((settings) => {
    applySettings(settings);
    if (!settings.customImage) pet.usePreset(settings.presetId, ctx.theme.dark);
  });
  api.on.menu(() => menu.open());

  // 首屏：先用本地快照填充（不联网），主进程的刷新会随后推送
  try {
    renderSnapshot(await api.data.snapshot());
  } catch (error) {
    panel.setStatus(error.message || String(error), 'error');
  }
  ctx.booted = true;

  const idle = createIdleSpeech({
    getSettings: () => ctx.settings,
    getSnapshot: () => ctx.snapshot,
    isBusy: () => panel.isOpen() || menu.isOpen() || diagnostics.isOpen() || toast.isVisible(),
    onSpeak: (line) => toast.showIdle(line),
  });
  idle.start();

  // 点击空白处关闭浮层；Esc 关闭；失焦关设置
  document.addEventListener('pointerdown', (event) => {
    const inside = (selector) => !!event.target.closest(selector);
    if (panel.isOpen() && !inside('#panel') && !inside('#whale')) panel.close();
    if (menu.isOpen() && !inside('#menu') && !inside('#whale')) menu.close();
    if (diagnostics.isOpen() && !inside('#diagnostics')) diagnostics.close();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    menu.close();
    diagnostics.close();
    panel.close();
  });

  window.addEventListener('blur', () => {
    if (menu.isOpen()) menu.close();
  });

  // 首次联网刷新交回主进程调度；这里只兜底一次，避免完全没数据
  if (!ctx.snapshot || !ctx.snapshot.ok) refreshData();

  document.body.dataset.ready = '1';
}

boot().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[whale] 启动失败', error);
  document.body.dataset.ready = '2';
  const status = $('#status');
  if (status) status.textContent = `启动失败：${error.message || error}`;
});
