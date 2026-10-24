'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const v = require('../app/lib/validate');

test('asNumber 夹取范围并处理脏值', () => {
  assert.equal(v.asNumber('1.5', 0), 1.5);
  assert.equal(v.asNumber('abc', 2), 2);
  assert.equal(v.asNumber(5, 0, { min: 0, max: 3 }), 3);
  assert.equal(v.asNumber(-1, 0, { min: 0, max: 3 }), 0);
});

test('asBoolean 只认 true/false 与字符串形式的布尔', () => {
  assert.equal(v.asBoolean(true), true);
  assert.equal(v.asBoolean('false'), false);
  assert.equal(v.asBoolean('yes', true), true);
  assert.equal(v.asBoolean(0, true), true);
});

test('asString 截断超长输入', () => {
  assert.equal(v.asString('abcdef', '', 3), 'abc');
  assert.equal(v.asString(123, 'fallback'), 'fallback');
});

test('asHexColor 只接受 #rrggbb', () => {
  assert.equal(v.asHexColor('#AABBCC'), '#aabbcc');
  assert.equal(v.asHexColor('red', '#000000'), '#000000');
  assert.equal(v.asHexColor('#fff', '#123456'), '#123456');
});

test('asOneOf 拒绝非法枚举', () => {
  assert.equal(v.asOneOf('dark', ['auto', 'dark'], 'auto'), 'dark');
  assert.equal(v.asOneOf('neon', ['auto', 'dark'], 'auto'), 'auto');
});

test('asStringArray 去空、去重长度、截断', () => {
  assert.deepEqual(v.asStringArray([' a ', '', 3, 'b']), ['a', 'b']);
  assert.equal(v.asStringArray(null), null);
  assert.deepEqual(
    v.asStringArray(Array.from({ length: 10 }, (_, i) => `line${i}`), { maxItems: 3 }).length,
    3
  );
});

test('asPoint 拒绝非数字坐标', () => {
  assert.deepEqual(v.asPoint({ x: 1.6, y: -2.2 }), { x: 2, y: -2 });
  assert.equal(v.asPoint({ x: 'a', y: 0 }), null);
  assert.equal(v.asPoint(null), null);
});
