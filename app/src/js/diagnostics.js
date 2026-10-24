/** 诊断面板：把主进程 + Python 侧的信息摊平成几行，排障时截个图就够。 */

import { $, clear, el, setText } from './dom.js';
import { stamp } from '../../shared/format.js';

const GROUPS = [
  {
    title: '运行环境',
    fields: [
      ['应用版本', (d) => d.app.version],
      ['Electron', (d) => d.app.electron],
      ['Node', (d) => d.app.node],
      ['平台', (d) => `${d.app.platform} / ${d.app.arch}`],
    ],
  },
  {
    title: '数据服务',
    fields: [
      ['状态', (d) => d.sidecar.state],
      ['版本', (d) => d.sidecar.version || '—'],
      ['PID', (d) => d.sidecar.pid || '—'],
      ['Python', (d) => d.sidecar.python || '—'],
      ['错误', (d) => (d.sidecar.error ? d.sidecar.error : '—')],
    ],
  },
  {
    title: '数据层',
    fields: [
      ['版本', (d) => (d.python && d.python.version) || '—'],
      ['数据目录', (d) => (d.python && d.python.home) || d.paths.dataDir],
      ['配置文件', (d) => (d.python && d.python.configPath) || d.paths.config],
      ['会话库', (d) => (d.python && d.python.sessionDb) || '未找到'],
      ['Cookie', (d) => (d.python && d.python.cookie) || '—'],
      ['存储方式', (d) => (d.python && d.python.cookieStoreHint) || '—'],
      ['DPAPI 可用', (d) => (d.python && d.python.encryption) || '—'],
      ['刷新间隔', (d) => `${(d.python && d.python.refreshSeconds) || '—'} 秒`],
    ],
  },
  {
    title: '调度',
    fields: [
      ['上次刷新', (d) => (d.brain && d.brain.lastRefreshAt ? stamp(d.brain.lastRefreshAt) : '尚未刷新')],
      ['自动刷新', (d) => (d.brain && d.brain.paused ? '已暂停' : '运行中')],
      ['最近错误', (d) => (d.brain && d.brain.error ? d.brain.error.message : '无')],
      ['开机自启', (d) => (d.autostart.enabled ? `已开启 · ${d.autostart.target || ''}` : '未开启')],
      ['日志', (d) => d.paths.log],
    ],
  },
];

export function createDiagnostics({ api }) {
  const root = $('#diagnostics');
  const body = $('#diagnostics-body');
  const closeButton = $('#diagnostics-close');
  let opened = false;

  function open() {
    if (!root || !body) return;
    opened = true;
    root.hidden = false;
    clear(body);
    body.append(el('p', { class: 'hint', text: '读取中…' }));
    api
      .diagnostics()
      .then((data) => render(data))
      .catch((error) => {
        clear(body);
        body.append(el('p', { class: 'hint is-error', text: error.message || String(error) }));
      });
  }

  function render(data) {
    clear(body);
    for (const group of GROUPS) {
      const container = el('div', { class: 'diagnostics__group' }, [
        el('div', { class: 'diagnostics__group-title', text: group.title }),
      ]);
      for (const [label, read] of group.fields) {
        let value = '—';
        try {
          value = read(data);
        } catch {
          value = '—';
        }
        container.append(
          el('div', { class: 'diagnostics__row' }, [
            el('span', { class: 'diagnostics__key', text: label }),
            el('span', { class: 'diagnostics__value', text: value === null || value === undefined ? '—' : String(value) }),
          ])
        );
      }
      body.append(container);
    }
  }

  function close() {
    opened = false;
    if (root) root.hidden = true;
  }

  if (closeButton) closeButton.addEventListener('click', close);

  return {
    open,
    close,
    isOpen: () => opened,
  };
}

export { setText };
