'use strict';

/**
 * 找一个能用的 Python。
 *
 * 顺序（第一个"确实存在"的胜出）：
 *   1. config.json 里 setup 记下的绝对路径
 *   2. 环境变量 MIMO_PYTHON
 *   3. MiMo 桌面端自带运行时（%APPDATA%\Xiaomi MiMo\runtimes\bundled\*\python\python.exe）
 *   4. PATH 上的 python / python3
 *
 * 关键点：**第 1 项必须校验存在性**。拷到另一台电脑时，config.json 里记录的
 * 是上一台机器的路径，如果不校验就会拿着一个不存在的 exe 去启动数据服务，
 * 表现为"明明装了 Python 却提示数据服务不可用"。校验失败记录到 staleConfig，
 * 由主进程用探测到的正确路径回写。
 */

const fs = require('node:fs');
const path = require('node:path');

const MIN_VERSION = [3, 9];
const MI_MO_RUNTIMES = path.join('Xiaomi MiMo', 'runtimes', 'bundled');

function listBundledPython(env) {
  const appData = env.APPDATA;
  if (!appData) return [];
  const root = path.join(appData, MI_MO_RUNTIMES);
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name, 'python', 'python.exe'))
    .filter((candidate) => fs.existsSync(candidate));
}

/**
 * @param {{env?: NodeJS.ProcessEnv, config?: object, exists?: (file: string) => boolean}} [options]
 * @returns {{exe: string, source: 'config'|'env'|'bundled'|'path', exists: boolean, staleConfig: string|null}}
 */
function findPython(options = {}) {
  const env = options.env || process.env;
  const config = options.config || {};
  const exists = options.exists || fs.existsSync;

  const fromConfig = String(config.python || '').trim();
  const fromEnv = String(env.MIMO_PYTHON || '').trim();

  const chain = [];
  if (fromConfig) chain.push({ exe: fromConfig, source: 'config' });
  if (fromEnv) chain.push({ exe: fromEnv, source: 'env' });
  for (const bundled of listBundledPython(env)) chain.push({ exe: bundled, source: 'bundled' });
  chain.push({ exe: process.platform === 'win32' ? 'python' : 'python3', source: 'path', command: true });

  // 记录"配置里写了一个不存在的路径"，供主进程纠正
  const staleConfig = fromConfig && !exists(fromConfig) ? fromConfig : null;

  for (const candidate of chain) {
    if (candidate.command || exists(candidate.exe)) {
      return { exe: candidate.exe, source: candidate.source, exists: true, staleConfig };
    }
  }

  const last = chain[chain.length - 1];
  return { exe: last.exe, source: last.source, exists: false, staleConfig };
}

/** 用 `-c` 探一次版本，失败返回 { ok:false, message }。 */
function probePython(exe, { spawnSyncImpl = require('node:child_process').spawnSync, timeout = 5000 } = {}) {
  const result = spawnSyncImpl(exe, ['-c', 'import sys;print("%d.%d" % sys.version_info[:2])'], {
    encoding: 'utf8',
    timeout,
    windowsHide: true,
  });
  if (result.error) return { ok: false, message: result.error.message };
  if (result.status !== 0) return { ok: false, message: (result.stderr || '').trim() || `退出码 ${result.status}` };
  const version = (result.stdout || '').trim();
  const [major, minor] = version.split('.').map(Number);
  if (major < MIN_VERSION[0] || (major === MIN_VERSION[0] && minor < MIN_VERSION[1])) {
    return { ok: false, message: `Python ${version} 过低，需要 3.9+` };
  }
  return { ok: true, version };
}

module.exports = { findPython, probePython, listBundledPython, MIN_VERSION };
