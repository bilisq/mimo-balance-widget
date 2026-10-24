'use strict';

/**
 * 界面偏好（settings.json）：Electron 独占写入。
 *
 * 与 Python 侧的 config.json 分工：
 *   config.json   —— 数据源（Cookie / Python 路径 / 刷新间隔），Python 写
 *   settings.json —— 界面（缩放 / 皮肤 / 台词 / 位置…），Electron 写
 * 两个文件各有唯一写入方，避免并发写同一个 JSON。
 */

const path = require('node:path');

const { readJson, writeJsonAtomic } = require('./atomic');
const v = require('./validate');

const SCHEMA = 1;
const PRESETS = ['xiaomi', 'xiaoai', 'whale'];
const THEMES = ['auto', 'light', 'dark'];
const TOAST_MODES = ['auto', 'custom'];
const DISPLAY_KEYS = ['plan', 'sessionTokens', 'cacheHit', 'context', 'turn'];

const DEFAULT_LINES = [
  '余额还够用吗？',
  '主人在忙什么呀？',
  '要不要看看 Token？',
  '今天也要加油鸭',
  '摸摸我～',
  '缓存命中好高呢',
];

const DEFAULTS = Object.freeze({
  schema: SCHEMA,
  scale: 1,
  presetId: 'xiaomi',
  customImage: null,
  speechEnabled: true,
  speechLines: DEFAULT_LINES,
  toastMode: 'auto',
  toastColors: { text: '#000000', fill: '#ffffff', stroke: '#FF6900' },
  display: { plan: true, sessionTokens: true, cacheHit: true, context: true, turn: true },
  balanceWarn: null,
  sessionId: null,
  theme: 'auto',
  window: null,
});

function normalizeWindow(value) {
  const point = v.asPoint(value);
  if (!point) return null;
  return { x: v.asInt(point.x, 0, { min: -20000, max: 20000 }), y: v.asInt(point.y, 0, { min: -20000, max: 20000 }) };
}

function normalize(input) {
  const source = input && typeof input === 'object' ? input : {};
  const display = {};
  for (const key of DISPLAY_KEYS) {
    display[key] = source.display && typeof source.display === 'object' && key in source.display
      ? v.asBoolean(source.display[key], true)
      : true;
  }

  const lines = v.asStringArray(source.speechLines);
  const warn = source.balanceWarn;

  return {
    schema: SCHEMA,
    scale: v.asNumber(source.scale, DEFAULTS.scale, { min: 0.6, max: 1.6 }),
    presetId: v.asOneOf(source.presetId, PRESETS, DEFAULTS.presetId),
    // 只存文件名（如 custom.png），不存绝对路径：
    // 数据目录换盘/换机器后，绝对路径会失效，自定义贴图就"消失"了。
    customImage: typeof source.customImage === 'string' && source.customImage
      ? path.basename(source.customImage)
      : null,
    speechEnabled: v.asBoolean(source.speechEnabled, DEFAULTS.speechEnabled),
    speechLines: lines && lines.length ? lines : [...DEFAULT_LINES],
    toastMode: v.asOneOf(source.toastMode, TOAST_MODES, DEFAULTS.toastMode),
    toastColors: {
      text: v.asHexColor(source.toastColors && source.toastColors.text, DEFAULTS.toastColors.text),
      fill: v.asHexColor(source.toastColors && source.toastColors.fill, DEFAULTS.toastColors.fill),
      stroke: v.asHexColor(source.toastColors && source.toastColors.stroke, DEFAULTS.toastColors.stroke),
    },
    display,
    balanceWarn: warn === null || warn === undefined || warn === '' ? null : v.asNumber(warn, 5, { min: 0, max: 1e6 }),
    sessionId: typeof source.sessionId === 'string' && source.sessionId ? source.sessionId.slice(0, 200) : null,
    theme: v.asOneOf(source.theme, THEMES, DEFAULTS.theme),
    window: normalizeWindow(source.window),
  };
}

class SettingsStore {
  constructor(file, logger) {
    this.file = file;
    this.logger = logger;
    this.value = normalize(DEFAULTS);
    this.load();
  }

  load() {
    const raw = readJson(this.file, null);
    this.value = normalize(raw || DEFAULTS);
    return this.value;
  }

  get() {
    return { ...this.value };
  }

  /** 合并并落盘；返回完整的新设置。 */
  save(patch) {
    this.value = normalize({ ...this.value, ...(patch && typeof patch === 'object' ? patch : {}) });
    try {
      writeJsonAtomic(this.file, this.value);
    } catch (error) {
      if (this.logger) this.logger.error('settings.save', error);
    }
    return this.get();
  }
}

module.exports = {
  SCHEMA,
  PRESETS,
  THEMES,
  TOAST_MODES,
  DISPLAY_KEYS,
  DEFAULT_LINES,
  DEFAULTS,
  normalize,
  SettingsStore,
};
