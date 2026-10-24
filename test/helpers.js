'use strict';

/** 测试辅助：仓库内临时目录（避开系统临时目录的各种限制）。 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const BASE = path.join(ROOT, '.tmp-test');

function tempDir(prefix = 'case-') {
  fs.mkdirSync(BASE, { recursive: true });
  const dir = path.join(BASE, `${prefix}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(dir, { recursive: true });
  process.on('exit', () => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* 清理失败不影响测试结果 */
    }
  });
  return dir;
}

module.exports = { ROOT, tempDir };
