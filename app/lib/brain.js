'use strict';

/**
 * 调度中枢：把"什么时候该查什么"集中在这里。
 *
 * 1. 探针（1.2s）：只读本地 SQLite，判断有没有新步骤 / 有没有在等用户。
 * 2. 快照（步骤变化时）：读缓存 + 现算本地会话数据，不联网。
 * 3. 刷新（默认 60s，或一轮结束时）：联网取余额与套餐，写缓存。
 *
 * 三个动作互相独立且有并发闸门：探针永远不会被网络请求拖慢，
 * 网络失败也不会影响界面上的本地数据。
 */

const { EventEmitter } = require('node:events');

const DEFAULT_TICK_MS = 1200;
const MAX_BACKOFF_MS = 5 * 60 * 1000;

class Brain extends EventEmitter {
  constructor({ sidecar, settings, logger, tickMs = DEFAULT_TICK_MS, refreshSeconds = 60 }) {
    super();
    this.sidecar = sidecar;
    this.settings = settings;
    this.logger = logger;
    this.tickMs = tickMs;
    this.refreshSeconds = Math.max(20, Math.min(3600, refreshSeconds));

    this.timer = null;
    this.probing = false;
    this.refreshing = false;
    this.lastStopTs = 0;
    this.lastCount = -1;
    this.lastRefreshAt = 0;
    this.backoffUntil = 0;
    this.backoffMs = 0;
    this.lastError = null;
    this.paused = false;
    this.lastTurnSeen = 0;
  }

  status() {
    return {
      refreshing: this.refreshing,
      probing: this.probing,
      lastRefreshAt: this.lastRefreshAt || null,
      error: this.lastError,
      paused: this.paused,
      refreshSeconds: this.refreshSeconds,
    };
  }

  start() {
    this.stop();
    this.timer = setInterval(() => this.tick(), this.tickMs);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  setRefreshSeconds(seconds) {
    const next = Number(seconds);
    if (!Number.isFinite(next)) return;
    this.refreshSeconds = Math.max(20, Math.min(3600, next));
  }

  pause(reason) {
    this.paused = true;
    this.lastError = reason || this.lastError;
    this.emit('status', this.status());
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.backoffUntil = 0;
    this.backoffMs = 0;
    this.lastError = null;
    this.emit('status', this.status());
  }

  async tick() {
    if (this.probing) return;
    this.probing = true;
    try {
      const probe = await this.sidecar.request('probe', { session: this.settings().sessionId }, { timeout: 8000 });
      this.emit('probe', probe);

      const stopTs = Number(probe && probe.lastStopTs) || 0;
      const count = Number(probe && probe.count);
      const countChanged = Number.isFinite(count) && count !== this.lastCount;

      if (stopTs && stopTs !== this.lastStopTs) {
        this.lastStopTs = stopTs;
        this.lastCount = Number.isFinite(count) ? count : this.lastCount;
        await this.refresh('turn');
        return;
      }
      if (countChanged) {
        this.lastCount = count;
        await this.snapshot('step');
      }
    } catch (error) {
      this.logger.debug('brain.probe', error.message);
    } finally {
      this.probing = false;
      this._scheduleAutoRefresh();
    }
  }

  _scheduleAutoRefresh() {
    if (this.paused || this.refreshing) return;
    if (Date.now() < this.backoffUntil) return;
    if (!this.lastRefreshAt) {
      // 启动后先来一次
      this.refresh('startup');
      return;
    }
    if (Date.now() - this.lastRefreshAt >= this.refreshSeconds * 1000) this.refresh('timer');
  }

  async snapshot(reason) {
    try {
      const data = await this.sidecar.request('snapshot', { session: this.settings().sessionId }, { timeout: 8000 });
      this.emit('snapshot', { ...data, reason });
      return data;
    } catch (error) {
      this.logger.debug('brain.snapshot', error.message);
      return null;
    }
  }

  /**
   * 联网刷新。失败时按指数退避，Cookie 失效则暂停自动刷新。
   * @param {string} reason startup | timer | turn | manual
   */
  async refresh(reason = 'manual') {
    if (this.refreshing) return null;
    this.refreshing = true;
    this.emit('status', this.status());
    try {
      const data = await this.sidecar.request('refresh', { session: this.settings().sessionId }, { timeout: 25000 });
      this.lastRefreshAt = Date.now();
      this.lastError = null;
      this.backoffMs = 0;
      this.backoffUntil = 0;

      const code = data && data.error && data.error.code;
      if (code) {
        this.lastError = data.error;
        if (code === 'COOKIE_INVALID' || code === 'NO_COOKIE') {
          this.pause(data.error);
        } else {
          this._bumpBackoff();
        }
      }
      this.emit('snapshot', { ...data, reason });
      return data;
    } catch (error) {
      this.lastError = { code: error.code || 'REFRESH_FAILED', message: error.message };
      this._bumpBackoff();
      this.emit('status', this.status());
      return null;
    } finally {
      this.refreshing = false;
      this.emit('status', this.status());
    }
  }

  _bumpBackoff() {
    this.backoffMs = this.backoffMs ? Math.min(this.backoffMs * 2, MAX_BACKOFF_MS) : 30000;
    this.backoffUntil = Date.now() + this.backoffMs;
  }

  /** 用户手动刷新：清掉暂停与退避。 */
  refreshNow() {
    this.resume();
    return this.refresh('manual');
  }
}

module.exports = { Brain };
