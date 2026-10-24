'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DEFAULTS, SettingsStore, normalize } = require('../app/lib/settings');
const { tempDir } = require('./helpers');

test('normalize 给出完整默认值', () => {
  const value = normalize(null);
  assert.equal(value.scale, 1);
  assert.equal(value.presetId, 'xiaomi');
  assert.equal(value.theme, 'auto');
  assert.equal(value.toastMode, 'auto');
  assert.equal(value.balanceWarn, null);
  assert.deepEqual(value.display, {
    plan: true,
    sessionTokens: true,
    cacheHit: true,
    context: true,
    turn: true,
  });
  assert.ok(Array.isArray(value.speechLines) && value.speechLines.length > 0);
});

test('normalize 夹取缩放并丢弃未知字段', () => {
  const value = normalize({ scale: 9, hack: 'x' });
  assert.equal(value.scale, 1.6);
  assert.equal(value.hack, undefined);
  assert.equal(normalize({ scale: 0.01 }).scale, 0.6);
});

test('normalize 校验皮肤与主题枚举', () => {
  assert.equal(normalize({ presetId: 'nope' }).presetId, 'xiaomi');
  assert.equal(normalize({ presetId: 'xiaoai' }).presetId, 'xiaoai');
  assert.equal(normalize({ theme: 'neon' }).theme, 'auto');
});

test('normalize 修正气泡配色', () => {
  const value = normalize({ toastMode: 'custom', toastColors: { text: 'red', fill: '#ffffff', stroke: '#FF6900' } });
  assert.equal(value.toastColors.text, DEFAULTS.toastColors.text);
  assert.equal(value.toastColors.stroke, '#ff6900');
});

test('speechLines 为空时回落默认台词', () => {
  assert.deepEqual(normalize({ speechLines: ['  ', ''] }).speechLines, DEFAULTS.speechLines);
});

test('window 位置非法时归零', () => {
  assert.equal(normalize({ window: { x: 'a', y: 1 } }).window, null);
  assert.deepEqual(normalize({ window: { x: 10.4, y: -3.6 } }).window, { x: 10, y: -4 });
});

test('customImage 只存文件名（数据目录搬移后仍能用）', () => {
  assert.equal(
    normalize({ customImage: 'C:\\Users\\a\\AppData\\Roaming\\MiMoWhale\\pets\\custom.png' }).customImage,
    'custom.png'
  );
  assert.equal(normalize({ customImage: '/home/a/.config/mimowhale/pets/custom.png' }).customImage, 'custom.png');
  assert.equal(normalize({ customImage: 'custom.png' }).customImage, 'custom.png');
  assert.equal(normalize({ customImage: '' }).customImage, null);
});

test('SettingsStore 读写往返', () => {
  const dir = tempDir('settings-');
  const file = path.join(dir, 'settings.json');
  const store = new SettingsStore(file, null);
  assert.equal(store.get().scale, 1);

  const next = store.save({ scale: 1.25, presetId: 'xiaoai', display: { plan: false } });
  assert.equal(next.scale, 1.25);
  assert.equal(next.display.plan, false);
  assert.equal(next.display.turn, true);

  const reloaded = new SettingsStore(file, null);
  assert.equal(reloaded.get().scale, 1.25);
  assert.equal(reloaded.get().presetId, 'xiaoai');
  assert.ok(fs.existsSync(file));
});

test('SettingsStore 对损坏文件不抛异常', () => {
  const dir = tempDir('settings-broken-');
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, '{ not json', 'utf8');
  const store = new SettingsStore(file, null);
  assert.equal(store.get().scale, 1);
});
