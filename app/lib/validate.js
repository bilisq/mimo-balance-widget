'use strict';

/** 输入校验：IPC 边界上只接受"干净"的数据，避免脏值直接进配置文件。 */

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function asNumber(value, fallback = 0, { min = -Infinity, max = Infinity } = {}) {
  const number = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(number)) return fallback;
  return clamp(number, min, max);
}

function asInt(value, fallback = 0, options = {}) {
  return Math.round(asNumber(value, fallback, options));
}

function asBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function asString(value, fallback = '', maxLength = 4096) {
  if (typeof value !== 'string') return fallback;
  return value.slice(0, maxLength);
}

function asHexColor(value, fallback = '#000000') {
  return HEX_COLOR.test(String(value)) ? String(value).toLowerCase() : fallback;
}

function asOneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function asStringArray(value, { maxItems = 30, maxLength = 120 } = {}) {
  if (!Array.isArray(value)) return null;
  return value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim().slice(0, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function asPoint(value) {
  if (!value || typeof value !== 'object') return null;
  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.round(x), y: Math.round(y) };
}

module.exports = {
  asNumber,
  asInt,
  asBoolean,
  asString,
  asHexColor,
  asOneOf,
  asStringArray,
  asPoint,
};
