/**
 * 闲时自言自语：每 3 分钟一次，只在屏幕上没有任何气泡时说话。
 * 有一定概率改说"当前余额"，比纯随机台词更有信息量。
 */

import { money } from '../../shared/format.js';

const FALLBACK_LINES = ['余额还够用吗？', '主人在忙什么呀？', '摸摸我～'];

export function createIdleSpeech({ getSettings, getSnapshot, isBusy, onSpeak, interval = 180000 }) {
  let timer = null;

  function threshold() {
    const settings = getSettings() || {};
    if (settings.balanceWarn !== null && settings.balanceWarn !== undefined) return Number(settings.balanceWarn);
    const snapshot = getSnapshot() || {};
    const official = snapshot.alertConfig;
    if (official && official.ok && official.threshold !== null && official.threshold !== undefined) return Number(official.threshold);
    return 5;
  }

  function pick() {
    const settings = getSettings() || {};
    const lines = (settings.speechLines || []).map((line) => String(line).trim()).filter(Boolean);
    const pool = lines.length ? lines : FALLBACK_LINES;

    const snapshot = getSnapshot();
    const amount = snapshot && snapshot.balance ? Number(snapshot.balance.amount) : NaN;
    if (Math.random() < 0.34 && Number.isFinite(amount)) {
      return {
        balance: money(amount, snapshot.balance.currency || 'CNY'),
        low: amount < threshold(),
      };
    }
    return { text: pool[Math.floor(Math.random() * pool.length)] };
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const settings = getSettings();
      if (settings && settings.speechEnabled && !isBusy()) onSpeak(pick());
      schedule();
    }, interval);
  }

  return {
    start: schedule,
    stop: () => {
      if (timer) clearTimeout(timer);
      timer = null;
    },
    reschedule: schedule,
  };
}
