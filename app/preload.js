'use strict';

/**
 * 预加载脚本：渲染层唯一能看到的能力面。
 *
 * 原则：
 * - 只暴露具名方法，不暴露 ipcRenderer 本身；
 * - 所有订阅都返回取消函数，避免页面重建后事件重复；
 * - 渲染层的未捕获错误转发给主进程，写进日志。
 */

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

function subscribe(channel, handler) {
  const listener = (_event, payload) => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('whale', {
  info: () => invoke('app:info'),

  settings: {
    get: () => invoke('settings:get'),
    save: (patch) => invoke('settings:save', patch),
  },

  cookie: {
    save: (value) => invoke('cookie:save', value),
  },

  petImage: {
    get: () => invoke('pet:image:get'),
    save: (payload) => invoke('pet:image:save', payload),
    reset: () => invoke('pet:image:reset'),
  },

  sessions: {
    list: () => invoke('sessions:list'),
    pin: (id) => invoke('session:pin', id),
  },

  data: {
    snapshot: () => invoke('data:snapshot'),
    refresh: () => invoke('data:refresh'),
  },

  theme: {
    get: () => invoke('theme:get'),
  },

  autostart: {
    get: () => invoke('autostart:get'),
    set: (enabled) => invoke('autostart:set', enabled),
  },

  diagnostics: () => invoke('diagnostics'),

  update: {
    check: () => invoke('update:check'),
  },

  open: (target) => invoke('shell:open', target),

  window: {
    geometry: () => invoke('window:geometry'),
    move: (point) => ipcRenderer.send('window:move', point),
    snap: () => ipcRenderer.send('window:snap'),
  },

  hide: () => ipcRenderer.send('app:hide'),
  quit: () => ipcRenderer.send('app:quit'),

  on: {
    snapshot: (handler) => subscribe('snapshot', handler),
    probe: (handler) => subscribe('probe', handler),
    theme: (handler) => subscribe('theme', handler),
    status: (handler) => subscribe('status', handler),
    settings: (handler) => subscribe('settings', handler),
    menu: (handler) => subscribe('menu:open', handler),
  },
});

window.addEventListener('error', (event) => {
  ipcRenderer.send('renderer:error', {
    message: event.message,
    stack: event.error && event.error.stack,
  });
});

window.addEventListener('unhandledrejection', (event) => {
  ipcRenderer.send('renderer:error', { message: `unhandledrejection: ${String(event.reason)}` });
});

// CSP 违规不会抛异常，只会让资源静默加载失败（典型症状：白屏但进程正常）。
// 这里把它转成一条错误上报，冒烟测试和日志都能看到。
window.addEventListener('securitypolicyviolation', (event) => {
  ipcRenderer.send('renderer:error', {
    message: `CSP 拦截：${event.violatedDirective} → ${event.blockedURI || '(inline)'}`,
  });
});
