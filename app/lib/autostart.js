'use strict';

/**
 * 开机自启：委托给 scripts/autostart.ps1（唯一实现）。
 *
 * 分工：
 *   PowerShell 负责建快捷方式（需要 WScript.Shell COM）并写 autostart.json
 *   Node 只负责调用与读取状态——两边都能改 lnk 会导致状态漂移
 *
 * 目录搬移后自愈：app 启动时若 autostart.json 显示 enabled，会按当前
 * 路径重跑一次（覆盖旧快捷方式），用户不需要手动处理。
 */

const { spawn } = require('node:child_process');
const { readJson } = require('./atomic');

class Autostart {
  constructor({ script, appRoot, dataDir, stateFile, logger, spawnImpl = spawn }) {
    this.script = script;
    this.appRoot = appRoot;
    this.dataDir = dataDir;
    this.stateFile = stateFile;
    this.logger = logger;
    this.spawnImpl = spawnImpl;
  }

  status() {
    const state = readJson(this.stateFile, {});
    return {
      enabled: !!state.enabled,
      target: state.target || null,
      updated: state.updated || null,
      supported: process.platform === 'win32',
    };
  }

  _run(action, timeout = 30000) {
    return new Promise((resolve) => {
      if (process.platform !== 'win32') {
        resolve({ ok: false, message: '当前系统不支持开机自启（仅 Windows）' });
        return;
      }
      let stdout = '';
      let stderr = '';
      let child;
      try {
        child = this.spawnImpl(
          'powershell.exe',
          ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', this.script, '-Action', action, '-AppRoot', this.appRoot, '-DataDir', this.dataDir],
          { windowsHide: true, timeout }
        );
      } catch (error) {
        resolve({ ok: false, message: error.message });
        return;
      }

      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* 忽略 */
        }
        resolve({ ok: false, message: '设置开机自启超时' });
      }, timeout);

      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        this.logger.error('autostart.spawn', error);
        resolve({ ok: false, message: error.message });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve({ ok: true, ...this.status() });
        } else {
          this.logger.warn('autostart.failed', stderr.trim() || stdout.trim());
          resolve({ ok: false, message: (stderr || stdout).trim() || `退出码 ${code}` });
        }
      });
    });
  }

  enable() {
    return this._run('install');
  }

  disable() {
    return this._run('uninstall');
  }

  /** 目录搬移后修复快捷方式；失败不影响使用。 */
  async repairIfEnabled() {
    if (!this.status().enabled) return { ok: true, skipped: true };
    const result = await this.enable();
    if (!result.ok) this.logger.warn('autostart.repair', result.message);
    return result;
  }
}

module.exports = { Autostart };
