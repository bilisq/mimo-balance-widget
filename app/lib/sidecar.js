'use strict';

/**
 * Python 常驻数据服务（sidecar）的客户端。
 *
 * 为什么不是"每次查询起一个进程"：解释器启动 + import 要 0.3~1.2 秒，
 * 而挂件需要秒级探针。常驻一个进程、走 NDJSON 一问一答，单次查询是毫秒级。
 *
 * 崩溃自愈：进程意外退出时按 1s / 2s / 5s 退避重启，最多 3 次；
 * 次数用尽则进入 unavailable 状态，由界面提示"运行 setup.cmd"。
 */

const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const { createLineReader, encodeRequest, parseEnvelope } = require('./ndjson');

const RESTART_DELAYS = [1000, 2000, 5000];
const MAX_RESTARTS = 3;
const START_TIMEOUT = 15000;

class SidecarError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SidecarError';
    this.code = code;
  }
}

class Sidecar extends EventEmitter {
  constructor({ python, pythonDir, dataDir, logger, spawnImpl = spawn }) {
    super();
    this.python = python;
    this.pythonDir = pythonDir;
    this.dataDir = dataDir;
    this.logger = logger;
    this.spawnImpl = spawnImpl;

    this.child = null;
    this.reader = null;
    this.state = 'idle'; // idle | starting | ready | unavailable | stopped
    this.error = null;
    this.version = null;
    this.pid = null;
    this.pending = new Map();
    this.nextId = 1;
    this.restarts = 0;
    this.stopping = false;
    this.waiters = [];
    this.restartTimer = null;
    this.starting = null;
    this.onReady = null;
    this.onFail = null;
  }

  status() {
    return {
      state: this.state,
      error: this.error,
      version: this.version,
      pid: this.pid,
      python: this.python,
    };
  }

  _setState(state, error = null) {
    this.state = state;
    this.error = error;
    if (state === 'ready') this._flushWaiters(true);
    if (state === 'unavailable' || state === 'stopped') {
      this._flushWaiters(false, new SidecarError('SIDECAR_UNAVAILABLE', error || '数据服务不可用'));
    }
    this.emit('state', this.status());
  }

  _env() {
    return {
      ...process.env,
      PYTHONPATH: this.pythonDir,
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
      PYTHONUNBUFFERED: '1',
      MIMO_WHALE_HOME: this.dataDir,
    };
  }

  _flushWaiters(ok, error) {
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      if (ok) waiter.resolve();
      else waiter.reject(error);
    }
    this.waiters = [];
  }

  _waitReady(timeout) {
    if (this.state === 'ready') return Promise.resolve();
    if (this.state === 'unavailable' || this.state === 'stopped') {
      return Promise.reject(new SidecarError('SIDECAR_UNAVAILABLE', this.error || '数据服务不可用'));
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters = this.waiters.filter((item) => item !== waiter);
          reject(new SidecarError('SIDECAR_TIMEOUT', '等待数据服务就绪超时'));
        }, timeout),
      };
      this.waiters.push(waiter);
    });
  }

  start() {
    if (this.state === 'ready') return Promise.resolve(this.status());
    if (this.starting) return this.starting;

    this.stopping = false;
    this._setState('starting');

    this.starting = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._setState('unavailable', `启动超时（${START_TIMEOUT / 1000}s）`);
        this._kill();
        reject(new SidecarError('SIDECAR_TIMEOUT', this.error));
      }, START_TIMEOUT);

      this.onReady = (payload) => {
        clearTimeout(timer);
        this.version = payload && payload.version ? String(payload.version) : null;
        this.pid = (payload && payload.pid) || null;
        this.restarts = 0;
        this.onReady = null;
        this.onFail = null;
        this._setState('ready');
        resolve(this.status());
      };

      this.onFail = (error) => {
        clearTimeout(timer);
        this.onReady = null;
        this.onFail = null;
        reject(error instanceof Error ? error : new SidecarError('SIDECAR_FAILED', String(error)));
      };

      this._spawn();
    }).finally(() => {
      this.starting = null;
    });

    return this.starting;
  }

  _spawn() {
    let child;
    try {
      child = this.spawnImpl(
        this.python,
        ['-u', '-X', 'utf8', '-m', 'whale.sidecar', '--home', this.dataDir],
        {
          cwd: this.pythonDir,
          env: this._env(),
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      );
    } catch (error) {
      this.logger.error('sidecar.spawn', error);
      this._setState('unavailable', error.message);
      if (this.onFail) this.onFail(new SidecarError('SIDECAR_SPAWN', error.message));
      return;
    }

    this.child = child;
    this.reader = createLineReader((line) => this._onLine(line));

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this.reader.push(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => this.logger.debug('sidecar.stderr', String(chunk).trim()));

    child.on('error', (error) => {
      this.logger.error('sidecar.child', error);
      this._setState('unavailable', error.message);
      if (this.onFail) this.onFail(new SidecarError('SIDECAR_ERROR', error.message));
    });

    child.on('exit', (code, signal) => {
      this.child = null;
      this._rejectAll(new SidecarError('SIDECAR_EXIT', `数据服务已退出（code=${code}, signal=${signal}）`));
      if (this.stopping) {
        this._setState('stopped');
        return;
      }
      if (this.onFail) this.onFail(new SidecarError('SIDECAR_EXIT', this.error || '数据服务启动失败'));
      this._scheduleRestart();
    });
  }

  _onLine(line) {
    const message = parseEnvelope(line);
    if (!message) {
      this.logger.warn('sidecar.badjson', line.slice(0, 200));
      return;
    }
    if (message.event === 'ready') {
      if (this.onReady) this.onReady(message.data);
      return;
    }
    if (message.id === null || message.id === undefined) return;
    const entry = this.pending.get(message.id);
    if (!entry) return;
    this.pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.ok) {
      entry.resolve(message.data);
    } else {
      const info = message.error || {};
      entry.reject(new SidecarError(info.code || 'SIDECAR_ERROR', info.message || '数据服务返回失败'));
    }
  }

  _rejectAll(error) {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
      this.pending.delete(id);
    }
  }

  _scheduleRestart() {
    if (this.stopping) return;
    if (this.restarts >= MAX_RESTARTS) {
      this._setState('unavailable', '数据服务多次启动失败，请运行 setup.cmd 检查 Python 环境');
      return;
    }
    const delay = RESTART_DELAYS[Math.min(this.restarts, RESTART_DELAYS.length - 1)];
    this.restarts += 1;
    this.logger.warn('sidecar.restart', `${delay}ms 后第 ${this.restarts} 次重启`);
    this._setState('starting', '数据服务重启中…');
    clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => {
      this.start().catch((error) => this.logger.error('sidecar.restart', error));
    }, delay);
    if (this.restartTimer.unref) this.restartTimer.unref();
  }

  _kill() {
    if (!this.child) return;
    try {
      this.child.kill();
    } catch {
      /* 忽略 */
    }
    this.child = null;
  }

  /**
   * 发一条命令并等结果。
   * @param {string} cmd
   * @param {object} [args]
   * @param {{timeout?: number}} [options]
   */
  async request(cmd, args = {}, options = {}) {
    const timeout = options.timeout || 20000;
    await this._waitReady(timeout);
    if (!this.child) throw new SidecarError('SIDECAR_UNAVAILABLE', this.error || '数据服务不可用');

    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new SidecarError('SIDECAR_TIMEOUT', `命令 ${cmd} 超时（${timeout}ms）`));
      }, timeout);

      this.pending.set(id, { resolve, reject, timer, cmd });
      try {
        this.child.stdin.write(encodeRequest(id, cmd, args));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new SidecarError('SIDECAR_WRITE', error.message));
      }
    });
  }

  ping() {
    return this.request('ping', {}, { timeout: 5000 });
  }

  stop() {
    this.stopping = true;
    clearTimeout(this.restartTimer);
    this._rejectAll(new SidecarError('SIDECAR_STOPPED', '数据服务已停止'));
    this._flushWaiters(false, new SidecarError('SIDECAR_STOPPED', '数据服务已停止'));
    const child = this.child;
    if (!child) {
      this._setState('stopped');
      return;
    }
    try {
      child.stdin.write(encodeRequest(0, 'shutdown', {}));
    } catch {
      /* 进程可能已退出 */
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* 忽略 */
      }
    }, 1500);
    if (timer.unref) timer.unref();
  }
}

module.exports = { Sidecar, SidecarError, MAX_RESTARTS };
