/**
 * 提示气泡：同一时刻只显示一个，按优先级抢占。
 *   idle(0) < turn(1) < pending(2)
 * pending 常驻，直到对应状态消失；turn 自动消失；idle 只在空场时出现。
 */

import { el } from './dom.js';

const ORDER = { idle: 0, turn: 1, pending: 2 };

// 气泡统一 5 秒自动消失（pending 是状态提示，常驻）
export const BUBBLE_TTL_MS = 5000;

export function createToast({ onChange } = {}) {
  const node = document.getElementById('toast');
  let current = null; // { kind, timer }

  function clearTimer() {
    if (current && current.timer) clearTimeout(current.timer);
  }

  function show(kind, children, ttl = 0) {
    if (!node) return false;
    if (current && ORDER[kind] < ORDER[current.kind]) return false;
    clearTimer();
    node.replaceChildren(...children);
    node.dataset.kind = kind;
    node.hidden = false;
    const timer = ttl > 0 ? setTimeout(() => hide(kind), ttl) : null;
    current = { kind, timer };
    if (onChange) onChange(true, kind);
    return true;
  }

  function hide(kind) {
    if (!node) return;
    if (!current && node.hidden) return;
    if (kind && current && current.kind !== kind) return;
    clearTimer();
    current = null;
    node.hidden = true;
    node.replaceChildren();
    if (onChange) onChange(false);
  }

  return {
    showTurn(info) {
      const title = el('span', { class: 'toast__title', text: `第 ${info.turn || 0} 轮 · ${info.steps || 0} 步` });
      const line1 = el('span', {
        class: 'toast__line',
        text: `${Number(info.billed || 0).toLocaleString('zh-CN')} tok · 花费 ${moneyText(info.cost)}`,
      });
      const speed = info.tokPerSec === null || info.tokPerSec === undefined ? '—' : `${info.tokPerSec} tok/s`;
      const line2 = el('span', {
        class: 'toast__line',
        text: `输出 ${Number(info.output || 0).toLocaleString('zh-CN')} tok · ${speed}`,
      });
      return show('turn', [title, line1, line2], BUBBLE_TTL_MS);
    },

    showPending(message, kind) {
      const title = el('span', { class: 'toast__title', text: kind === 'auth' ? '等待授权' : '等待回答' });
      const text = el('span', { class: 'toast__line', text: message || '正在等待主人…' });
      return show('pending', [title, text], 0);
    },

    showIdle({ text, balance, low }) {
      const children = [];
      if (balance) {
        children.push(el('span', { class: `toast__balance${low ? ' is-low' : ''}`, text: balance }));
      } else {
        children.push(el('span', { class: 'toast__line', text: text || '…' }));
      }
      return show('idle', children, BUBBLE_TTL_MS);
    },

    hide,
    hideAll: () => hide(),
    isVisible: () => !!node && !node.hidden,
    kind: () => (current ? current.kind : null),
  };
}

function moneyText(value) {
  const number = Number(value || 0);
  return `¥${number.toFixed(2)}`;
}
