'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// app/shared 是 ESM（package.json type=module），CJS 测试用动态 import 加载
const load = () => import('../app/shared/format.js');
const loadGeometry = () => import('../app/shared/geometry.js');

test('money 处理空值、货币符号与千分位', async () => {
  const { money } = await load();
  assert.equal(money(null), '—');
  assert.equal(money(undefined), '—');
  assert.equal(money('abc'), '—');
  assert.equal(money(1234.5), '¥1,234.50');
  assert.equal(money(0, 'USD'), 'USD 0.00');
});

test('tokens 用 K / M 缩写', async () => {
  const { tokens } = await load();
  assert.equal(tokens(999), '999');
  assert.equal(tokens(1500), '1.5K');
  assert.equal(tokens(2_500_000), '2.50M');
  assert.equal(tokens(null), '0');
});

test('percent 保留一位小数', async () => {
  const { percent } = await load();
  assert.equal(percent(15.64), '15.6%');
  assert.equal(percent(0), '0.0%');
  assert.equal(percent(undefined), '—');
});

test('clock 对非法时间返回空串', async () => {
  const { clock } = await load();
  assert.equal(clock(''), '');
  assert.equal(clock('not a date'), '');
  assert.match(clock('2026-10-19T12:34:56+08:00'), /\d{2}:\d{2}/);
});

test('几何常量与 insets 自洽', async () => {
  const { PET, WINDOW, petInsets } = await loadGeometry();
  const insets = petInsets();
  assert.equal(insets.left, WINDOW.width - PET.width);
  assert.equal(insets.top, WINDOW.height - PET.height);
  assert.equal(insets.right, 0);
  assert.equal(insets.bottom, 0);
  // 宠物必须能完整放进窗口
  assert.ok(PET.width <= WINDOW.width);
  assert.ok(PET.height <= WINDOW.height);
});

test('petRect 把窗口坐标换算成宠物矩形', async () => {
  const { PET, WINDOW, petRect } = await loadGeometry();
  const rect = petRect({ x: 100, y: 200 });
  assert.equal(rect.left, 100 + WINDOW.width - PET.width);
  assert.equal(rect.top, 200 + WINDOW.height - PET.height);
  assert.equal(rect.width, PET.width);
  assert.equal(rect.height, PET.height);
});
