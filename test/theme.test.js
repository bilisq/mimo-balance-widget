'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { readMimoTheme, resolveTheme } = require('../app/lib/theme');
const { tempDir } = require('./helpers');

test('设置里的显式主题优先于一切', () => {
  assert.deepEqual(resolveTheme({ settingsTheme: 'dark', mimoTheme: 'light', shouldUseDarkColors: false }), {
    dark: true,
    mode: 'dark',
    source: 'settings',
  });
});

test('未指定时跟随 MiMo 偏好', () => {
  assert.equal(resolveTheme({ settingsTheme: 'auto', mimoTheme: 'dark', shouldUseDarkColors: false }).dark, true);
  assert.equal(resolveTheme({ settingsTheme: 'auto', mimoTheme: 'dark' }).source, 'mimo');
});

test('都没有时跟随系统', () => {
  const result = resolveTheme({ settingsTheme: 'auto', mimoTheme: null, shouldUseDarkColors: true });
  assert.equal(result.dark, true);
  assert.equal(result.source, 'system');
});

test('非法主题值当作 auto', () => {
  assert.equal(resolveTheme({ settingsTheme: 'purple', shouldUseDarkColors: false }).dark, false);
});

test('readMimoTheme 解析 preferences.json，坏文件返回 null', () => {
  const dir = tempDir('theme-');
  const ok = path.join(dir, 'preferences.json');
  fs.writeFileSync(ok, JSON.stringify({ theme: 'Dark' }), 'utf8');
  assert.equal(readMimoTheme(ok), 'dark');

  const bad = path.join(dir, 'bad.json');
  fs.writeFileSync(bad, 'not json', 'utf8');
  assert.equal(readMimoTheme(bad), null);
  assert.equal(readMimoTheme(path.join(dir, 'missing.json')), null);

  const other = path.join(dir, 'other.json');
  fs.writeFileSync(other, JSON.stringify({ theme: 'neon' }), 'utf8');
  assert.equal(readMimoTheme(other), null);
});
