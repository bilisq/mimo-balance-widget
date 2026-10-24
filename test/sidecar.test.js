'use strict';

/**
 * sidecar 客户端测试：用假的子进程验证分帧、请求/响应匹配、错误映射、超时与重启。
 * 不真正 spawn，所以在任何环境（包括没有 Python 的 CI）都能跑。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');

const { Sidecar, MAX_RESTARTS } = require('../app/lib/sidecar');

const quietLogger = { debug() {}, info() {}, warn() {}, error() {}, file: '' };

/**
 * 造一个"像 Python sidecar"的假子进程。
 * @param {(message: any, reply: (obj: object) => void) => void} onRequest
 */
function fakeChild(onRequest, { ready = true, readyDelay = 0 } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;

  const reply = (obj) => child.stdout.write(`${JSON.stringify(obj)}\n`);
  const raw = (text) => child.stdout.write(text);

  child.stdin = new Writable({
    write(chunk, _encoding, callback) {
      for (const line of String(chunk).split('\n')) {
        if (!line.trim()) continue;
        onRequest(JSON.parse(line), reply, raw);
      }
      callback();
    },
  });

  child.kill = () => {
    child.killed = true;
    child.emit('exit', 0, 'SIGTERM');
  };

  if (ready) {
    setTimeout(() => reply({ event: 'ready', version: '9.9.9', pid: 4242 }), readyDelay);
  }
  return child;
}

function makeSidecar(onRequest, options) {
  const children = [];
  const sidecar = new Sidecar({
    python: 'python',
    pythonDir: '/tmp/python',
    dataDir: '/tmp/data',
    logger: quietLogger,
    spawnImpl: () => {
      const child = fakeChild(onRequest, options);
      children.push(child);
      return child;
    },
  });
  return { sidecar, children };
}

test('start 等到 ready 事件', async () => {
  const { sidecar } = makeSidecar((message, reply) => {
    if (message.cmd === 'ping') reply({ id: message.id, ok: true, data: { version: '9.9.9' } });
  });
  const status = await sidecar.start();
  assert.equal(status.state, 'ready');
  assert.equal(status.version, '9.9.9');
  assert.equal(status.pid, 4242);
  sidecar.stop();
});

test('request 按 id 匹配响应，负载原样返回', async () => {
  const { sidecar } = makeSidecar((message, reply) => {
    if (message.cmd === 'probe') {
      reply({ id: message.id, ok: true, data: { ok: true, count: 3, pending: null } });
    }
  });
  await sidecar.start();
  const data = await sidecar.request('probe', { session: 's1' });
  assert.equal(data.count, 3);
  sidecar.stop();
});

test('错误信封转成 SidecarError，带原始 code', async () => {
  const { sidecar } = makeSidecar((message, reply) => {
    reply({ id: message.id, ok: false, error: { code: 'NO_DB', message: '找不到库' } });
  });
  await sidecar.start();
  await assert.rejects(() => sidecar.request('probe'), (error) => {
    assert.equal(error.code, 'NO_DB');
    assert.match(error.message, /找不到库/);
    return true;
  });
  sidecar.stop();
});

test('请求超时会拒绝而不是一直挂着', async () => {
  const { sidecar } = makeSidecar(() => {
    /* 永不响应 */
  });
  await sidecar.start();
  await assert.rejects(() => sidecar.request('probe', {}, { timeout: 60 }), (error) => {
    assert.equal(error.code, 'SIDECAR_TIMEOUT');
    return true;
  });
  sidecar.stop();
});

test('多行粘包也能正确分帧', async () => {
  const { sidecar } = makeSidecar((message, _reply, raw) => {
    if (message.cmd !== 'ping') return;
    // 一次写入两行 + 半行，模拟真实管道里常见的粘包/断包
    raw(`${JSON.stringify({ id: 999, ok: true, data: { ignored: true } })}\n`);
    raw(`${JSON.stringify({ id: message.id, ok: true, data: { pong: true } })}\n{"id":`);
  });
  await sidecar.start();
  const data = await sidecar.request('ping');
  assert.equal(data.pong, true);
  sidecar.stop();
});

test('进程意外退出：拒绝挂起请求并进入重启流程', async () => {
  const { sidecar, children } = makeSidecar(() => {});
  await sidecar.start();
  const pending = sidecar.request('probe', {}, { timeout: 5000 });
  // 等请求真正发出、登记进 pending 之后再模拟崩溃
  await new Promise((resolve) => setImmediate(resolve));
  children[0].emit('exit', 1, null);
  await assert.rejects(() => pending, (error) => {
    assert.equal(error.code, 'SIDECAR_EXIT');
    return true;
  });
  assert.equal(sidecar.state, 'starting', '应进入重启流程');
  assert.equal(sidecar.restarts, 1);
  sidecar.stop();
});

test('重启次数用尽后进入 unavailable 并给出可操作提示', async () => {
  const { sidecar, children } = makeSidecar(() => {});
  await sidecar.start();
  sidecar.restarts = MAX_RESTARTS;
  children[0].emit('exit', 1, null);
  assert.equal(sidecar.state, 'unavailable');
  assert.match(sidecar.error, /setup\.cmd/);
  sidecar.stop();
});

test('unavailable 状态下请求直接失败，不傻等', async () => {
  const { sidecar } = makeSidecar(() => {});
  sidecar.state = 'unavailable';
  sidecar.error = '没找到 Python';
  await assert.rejects(() => sidecar.request('ping', {}, { timeout: 5000 }), (error) => {
    assert.equal(error.code, 'SIDECAR_UNAVAILABLE');
    assert.match(error.message, /没找到 Python/);
    return true;
  });
});
