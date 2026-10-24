'use strict';

/**
 * 跑 Python 单测，自动找可用的解释器（与挂件运行时同一套逻辑）。
 * 找不到 Python 时以退出码 1 结束并给出提示，而不是抛一大堆 ENOENT。
 *
 * 用法：npm run test:py
 */

const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const { findPython } = require('../app/lib/python');
const { defaultDataDir } = require('../app/lib/paths');
const { readJson } = require('../app/lib/atomic');

const ROOT = path.resolve(__dirname, '..');
const dataDir = defaultDataDir();
const config = readJson(path.join(dataDir, 'config.json'), {});
const python = findPython({ env: process.env, config });

if (!python || (python.source === 'config' && !fs.existsSync(python.exe))) {
  process.stderr.write('未找到可用的 Python（3.9+）。安装 MiMo 桌面端或从 python.org 安装后重试。\n');
  process.exit(1);
}

const result = spawnSync(
  python.exe,
  ['-X', 'utf8', '-m', 'unittest', 'discover', '-s', 'python/tests', '-t', 'python'],
  {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      PYTHONPATH: path.join(ROOT, 'python'),
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
    },
  }
);

if (result.error) {
  process.stderr.write(`无法启动 Python：${result.error.message}\n`);
  process.exit(1);
}
process.exit(result.status === null ? 1 : result.status);
