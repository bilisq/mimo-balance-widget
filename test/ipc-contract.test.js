'use strict';

/**
 * 渲染层 ↔ 主进程的 IPC 契约测试。
 * 没有浏览器也能发现"preload 调了一个没人注册的通道"这类低级错误。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ROOT } = require('./helpers');

const preload = fs.readFileSync(path.join(ROOT, 'app', 'preload.js'), 'utf8');
const ipc = fs.readFileSync(path.join(ROOT, 'app', 'lib', 'ipc.js'), 'utf8');
const main = fs.readFileSync(path.join(ROOT, 'app', 'main.js'), 'utf8');

const unique = (iterable) => Array.from(new Set(iterable));

const invoked = unique(Array.from(preload.matchAll(/invoke\('([^']+)'/g), (m) => m[1]));
const sent = unique(Array.from(preload.matchAll(/ipcRenderer\.send\('([^']+)'/g), (m) => m[1]));
const subscribed = unique(Array.from(preload.matchAll(/subscribe\('([^']+)'/g), (m) => m[1]));

const handled = unique(Array.from(ipc.matchAll(/\bhandle\('([^']+)'/g), (m) => m[1]));
const listened = unique(Array.from(ipc.matchAll(/\bon\('([^']+)'/g), (m) => m[1]));

test('preload 的每个 invoke 都有主进程 handler', () => {
  const missing = invoked.filter((channel) => !handled.includes(channel));
  assert.deepEqual(missing, [], `缺少 handler：${missing.join(', ')}`);
});

test('preload 的每个 send 都有主进程监听', () => {
  const missing = sent.filter((channel) => !listened.includes(channel) && channel !== 'renderer:error');
  assert.deepEqual(missing, [], `缺少监听：${missing.join(', ')}`);
});

test('preload 订阅的通道都由主进程推送', () => {
  const missing = subscribed.filter((channel) => !main.includes(`send('${channel}'`));
  assert.deepEqual(missing, [], `主进程从未推送：${missing.join(', ')}`);
});

test('主进程 handler 都被 preload 用到（无死通道）', () => {
  const dead = handled.filter((channel) => !invoked.includes(channel));
  assert.deepEqual(dead, [], `这些 handler 没有被 preload 调用：${dead.join(', ')}`);
});

test('preload 不直接暴露 ipcRenderer', () => {
  assert.ok(!/exposeInMainWorld\([^)]*ipcRenderer/.test(preload), '不应把 ipcRenderer 整个暴露给页面');
  assert.match(preload, /contextBridge\.exposeInMainWorld\('whale'/, '必须通过 contextBridge 暴露具名接口');
});
