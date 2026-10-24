'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { findPython, MIN_VERSION } = require('../app/lib/python');
const { tempDir } = require('./helpers');

const alwaysExists = () => true;
const neverExists = () => false;

test('config 里的路径存在时优先使用', () => {
  const result = findPython({
    env: { MIMO_PYTHON: 'C:\\env\\python.exe' },
    config: { python: 'C:\\cfg\\python.exe' },
    exists: alwaysExists,
  });
  assert.equal(result.source, 'config');
  assert.equal(result.exe, 'C:\\cfg\\python.exe');
  assert.equal(result.staleConfig, null);
});

test('config 路径失效时回落到环境变量，并记录 staleConfig', () => {
  const exists = (file) => file === 'C:\\env\\python.exe';
  const result = findPython({
    env: { MIMO_PYTHON: 'C:\\env\\python.exe' },
    config: { python: 'C:\\old-machine\\python.exe' },
    exists,
  });
  assert.equal(result.source, 'env');
  assert.equal(result.exe, 'C:\\env\\python.exe');
  assert.equal(result.staleConfig, 'C:\\old-machine\\python.exe');
});

test('配置全部失效时回落到 PATH（换电脑后不会卡死）', () => {
  const result = findPython({
    env: {},
    config: { python: 'C:\\old-machine\\python.exe' },
    exists: neverExists,
  });
  assert.equal(result.source, 'path');
  assert.match(result.exe, /^python/);
  assert.equal(result.exists, true, '命令名交给 PATH 解析，不能判为不存在');
  assert.equal(result.staleConfig, 'C:\\old-machine\\python.exe');
});

test('没有任何配置时不产生 staleConfig', () => {
  const result = findPython({ env: {}, config: {}, exists: neverExists });
  assert.equal(result.source, 'path');
  assert.equal(result.staleConfig, null);
});

test('MiMo 自带运行时排在 PATH 之前', () => {
  const appData = tempDir('mimo-runtime-');
  const bundled = path.join(appData, 'Xiaomi MiMo', 'runtimes', 'bundled', 'abc123', 'python');
  fs.mkdirSync(bundled, { recursive: true });
  fs.writeFileSync(path.join(bundled, 'python.exe'), '');

  const result = findPython({ env: { APPDATA: appData }, config: {}, exists: fs.existsSync });
  assert.equal(result.source, 'bundled');
  assert.equal(result.exe, path.join(bundled, 'python.exe'));
});

test('最低版本是 3.9', () => {
  assert.deepEqual(MIN_VERSION, [3, 9]);
});
