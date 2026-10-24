'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { defaultDataDir, resolvePaths } = require('../app/lib/paths');

test('Windows 默认目录是 %APPDATA%\\MiMoWhale', () => {
  const dir = defaultDataDir({
    env: { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' },
    platform: 'win32',
    home: 'C:\\Users\\a',
  });
  assert.equal(dir, path.join('C:\\Users\\a\\AppData\\Roaming', 'MiMoWhale'));
});

test('MIMO_WHALE_HOME 覆盖默认值', () => {
  const dir = defaultDataDir({
    env: { MIMO_WHALE_HOME: 'D:\\whale' },
    platform: 'win32',
    home: 'C:\\Users\\a',
  });
  assert.equal(dir, path.resolve('D:\\whale'));
});

test('非 Windows 走 XDG 目录', () => {
  const dir = defaultDataDir({ env: { XDG_CONFIG_HOME: '/home/a/.config' }, platform: 'linux', home: '/home/a' });
  assert.equal(dir, path.join('/home/a/.config', 'mimowhale'));
});

test('APPDATA 缺失时回落到用户目录', () => {
  const dir = defaultDataDir({ env: {}, platform: 'win32', home: 'C:\\Users\\a' });
  assert.equal(dir, path.join('C:\\Users\\a', 'AppData', 'Roaming', 'MiMoWhale'));
});

test('resolvePaths 把状态文件都放在 dataDir 下', () => {
  const paths = resolvePaths({ appRoot: 'C:\\repo', env: { MIMO_WHALE_HOME: 'C:\\data' } });
  assert.equal(paths.appRoot, 'C:\\repo');
  assert.equal(paths.dataDir, path.resolve('C:\\data'));
  for (const key of ['config', 'cache', 'ledger', 'settings', 'autostartState']) {
    assert.ok(paths[key].startsWith(paths.dataDir), `${key} 应在 dataDir 内`);
  }
  assert.ok(paths.indexHtml.startsWith(paths.appRoot));
  assert.ok(paths.preload.startsWith(paths.appRoot));
});

test('缺少 appRoot 直接报错，避免静默写到错误位置', () => {
  assert.throws(() => resolvePaths({}), /appRoot/);
});
