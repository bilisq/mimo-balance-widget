'use strict';

/** JSON 读写：原子写，容错读。 */

const fs = require('node:fs');
const path = require('node:path');

function readJson(file, fallback = null) {
  try {
    // Windows 侧可能是 PowerShell 写出的 UTF-8 BOM（例如 autostart.json），
    // JSON.parse 不认 BOM，这里统一剥掉。
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch (error) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* 忽略 */
    }
    throw error;
  }
}

module.exports = { readJson, writeJsonAtomic };
