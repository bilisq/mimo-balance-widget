/** 展示格式化：与 Python 侧 format.py 保持一致的显示口径（可被 Node 单测直接 import）。 */

export function money(value, currency = 'CNY') {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  const symbol = String(currency || 'CNY').toUpperCase() === 'CNY' ? '¥' : `${currency} `;
  return `${symbol}${number.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function tokens(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return '0';
  if (number >= 1e6) return `${(number / 1e6).toFixed(2)}M`;
  if (number >= 1e3) return `${(number / 1e3).toFixed(1)}K`;
  return String(Math.round(number));
}

export function percent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${number.toFixed(1)}%`;
}

/** ISO 时间 → HH:MM；不可解析时返回空串。 */
export function clock(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

/** 毫秒时间戳 → 简短时间（会话列表用）。 */
export function stamp(ms) {
  const date = new Date(Number(ms) || 0);
  if (Number.isNaN(date.getTime()) || !ms) return '';
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
