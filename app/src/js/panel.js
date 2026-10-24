/**
 * 余额面板：只负责把快照渲染成 DOM。
 * 不联网、不读设置文件——数据由 app.js 通过 render(payload) 推进来。
 */

import { $, $$, on, setText } from './dom.js';
import { clock, money, percent, tokens } from '../../shared/format.js';

export function createPanel({ api, onOpen, onClose }) {
  const root = $('#panel');
  const els = {
    balance: $('#balance'),
    cashGift: $('#cash-gift'),
    plan: $('#plan'),
    planBar: $('#plan-bar'),
    spend: $('#spend'),
    sessionTokens: $('#session-tokens'),
    cacheHit: $('#cache-hit'),
    context: $('#context'),
    turn: $('#turn'),
    status: $('#status'),
    close: $('#panel-close'),
  };

  let settings = null;
  let opened = false;

  function displayOpts() {
    const display = (settings && settings.display) || {};
    for (const node of $$('[data-opt]', root)) {
      node.hidden = display[node.dataset.opt] === false;
    }
  }

  function threshold(payload) {
    if (settings && settings.balanceWarn !== null && settings.balanceWarn !== undefined) return Number(settings.balanceWarn);
    const official = payload && payload.alertConfig;
    if (official && official.ok && official.threshold !== null && official.threshold !== undefined) return Number(official.threshold);
    return 5;
  }

  function setStatus(text, kind = '') {
    if (!els.status) return;
    els.status.textContent = text || '';
    els.status.className = `status${kind ? ` is-${kind}` : ''}`;
  }

  function render(payload) {
    if (!root) return;
    displayOpts();
    if (!payload) {
      setStatus('还没有数据', 'warn');
      return;
    }

    if (!payload.ok || !payload.balance) {
      setText(els.balance, '—');
      const error = payload.error || {};
      setStatus(error.message || '暂无数据', 'error');
      return;
    }

    const balance = payload.balance;
    const plan = payload.tokenPlan || {};
    const book = payload.ledger || {};
    const currency = balance.currency || 'CNY';
    const limit = threshold(payload);

    setText(els.balance, money(balance.amount, currency));
    els.balance.classList.toggle('is-low', Number(balance.amount) < limit);

    const cash = balance.cash === null || balance.cash === undefined ? '—' : money(balance.cash, currency);
    const gift = balance.gift === null || balance.gift === undefined ? '—' : money(balance.gift, currency);
    setText(els.cashGift, `${cash} / ${gift}`);

    if (plan.error) {
      // 查不到 ≠ 没开通：两者显示必须不同，否则用户会以为套餐没了
      setText(els.plan, '查询失败');
      if (els.plan) els.plan.title = plan.message || plan.error;
      if (els.planBar) {
        els.planBar.style.width = '0%';
        els.planBar.classList.remove('is-low', 'is-mid');
      }
    } else if (plan.hasPlan) {
      setText(els.plan, `${plan.planCode || '套餐'} · ${percent(plan.percent)} · ${tokens(plan.used)}`);
      if (els.plan) els.plan.title = '';
      const remain = Math.max(0, Math.min(100, 100 - Number(plan.percent || 0)));
      if (els.planBar) {
        els.planBar.style.width = `${remain.toFixed(1)}%`;
        const level = Number(plan.percent || 0);
        els.planBar.classList.toggle('is-low', level >= 90);
        els.planBar.classList.toggle('is-mid', level >= 70 && level < 90);
      }
    } else {
      setText(els.plan, '未开通');
      if (els.plan) els.plan.title = '';
      if (els.planBar) {
        els.planBar.style.width = '0%';
        els.planBar.classList.remove('is-low', 'is-mid');
      }
    }

    // 账本是"余额差值"推算的：退款、赠金到账/过期都会被算进来，
    // 所以标成 ≈ 并在 tooltip 里说清楚，别让用户当成精确账单。
    setText(els.spend, `≈ ${money(book.today, currency)} / ${money(book.week7, currency)}`);
    if (els.spend) els.spend.title = '按余额差值估算，赠金变动与退款会算进消耗';

    const stats = payload.sessionTokens || {};
    if (stats.ok === false) {
      setText(els.sessionTokens, '—');
      setText(els.cacheHit, '—');
      setText(els.context, '—');
      // 把原因挂在 title 上：MiMo 换轨迹格式时，用户能看到"为什么是空的"
      if (els.sessionTokens) els.sessionTokens.title = stats.message || stats.error || '';
    } else {
      const statsTokens = stats.tokens || {};
      const cache = stats.cache || {};
      setText(els.sessionTokens, `${tokens(statsTokens.billed)} tok · ${money(stats.cost, currency)}`);
      setText(els.cacheHit, cache.hitRate === null || cache.hitRate === undefined ? '—' : percent(cache.hitRate));
      setText(els.context, `${tokens(statsTokens.contextLast)} tok`);
      if (els.sessionTokens) els.sessionTokens.title = `${Number(statsTokens.billed || 0).toLocaleString('zh-CN')} tok`;
      if (els.context) els.context.title = `${Number(statsTokens.contextLast || 0).toLocaleString('zh-CN')} tok`;
    }

    const turn = payload.lastTurn;
    if (turn && turn.ok) {
      const speed = turn.tokPerSec === null || turn.tokPerSec === undefined ? '—' : `${turn.tokPerSec} tok/s`;
      setText(els.turn, `第 ${turn.turn || 0} 轮 · ${turn.steps || 0} 步 · ${speed}`);
    } else {
      setText(els.turn, '—');
    }

    // 状态行：优先显示错误，其次显示数据新鲜度
    if (payload.error && payload.error.message) {
      const cacheHint = payload.source === 'cache' ? '（显示缓存）' : '';
      setStatus(`${payload.error.message}${cacheHint}`, 'error');
    } else if (payload.stale) {
      const age = clock(payload.generatedAt);
      setStatus(`缓存数据${age ? ` · ${age}` : ''}`, 'warn');
    } else {
      setStatus(`已更新 ${clock(payload.generatedAt) || ''}`.trim(), 'ok');
    }
    if (payload.error && payload.error.code === 'NO_COOKIE') {
      setStatus('未配置 Cookie：打开设置粘贴后即可刷新', 'warn');
    }
  }

  function setSettings(next) {
    settings = next;
    displayOpts();
  }

  function open() {
    if (!root) return;
    opened = true;
    root.hidden = false;
    if (onOpen) onOpen();
    // 打开面板时先给一份本地快照（不联网），主进程随后会推送刷新结果
    api.data
      .snapshot()
      .then(render)
      .catch((error) => setStatus(error.message || String(error), 'error'));
  }

  function close() {
    if (!root) return;
    opened = false;
    root.hidden = true;
    if (onClose) onClose();
  }

  on(els.close, 'click', (event) => {
    event.stopPropagation();
    close();
  });

  return {
    render,
    setStatus,
    setSettings,
    open,
    close,
    toggle: () => (opened ? close() : open()),
    isOpen: () => opened,
    element: root,
  };
}
