/**
 * 轻量"lint"：语法 + 编码守卫
 *
 *  1. .ps1 必须是 UTF-8 with BOM（Windows PowerShell 5.1 否则按 ANSI 读，中文注释会破坏语法）
 *  2. .cmd / .bat 必须是纯 ASCII（cmd.exe 按系统代码页读，中文会乱码）
 *  3. 所有 JS 能被解析、所有 JSON 合法
 *
 * 用法：node scripts/check-syntax.js
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.tmp',
  '.tmp-test',
  '.tmp-test-py',
  '.tmp-run',
  '__pycache__',
  'logs',
  'dist',
  'release',
]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

const files = walk(ROOT);
const jsFiles = files.filter((file) => file.endsWith('.js') || file.endsWith('.mjs'));
const jsonFiles = files.filter((file) => file.endsWith('.json'));
const ps1Files = files.filter((file) => file.endsWith('.ps1'));
const cmdFiles = files.filter((file) => file.endsWith('.cmd') || file.endsWith('.bat'));

const failures = [];
const rel = (file) => path.relative(ROOT, file);

for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'ignore' });
  if (result.error) {
    failures.push(`[JS] ${rel(file)}: 无法执行检查（${result.error.code}）`);
  } else if (result.status !== 0) {
    failures.push(`[JS] ${rel(file)}: 语法错误（手动执行 node --check 查看详情）`);
  }
}

for (const file of jsonFiles) {
  try {
    JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    failures.push(`[JSON] ${rel(file)}: ${error.message}`);
  }
}

for (const file of ps1Files) {
  const bytes = fs.readFileSync(file);
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  if (!hasBom) {
    failures.push(`[PS1] ${rel(file)}: 缺少 UTF-8 BOM（PowerShell 5.1 会按 ANSI 读取，中文会破坏语法）`);
  }
}

for (const file of cmdFiles) {
  const bytes = fs.readFileSync(file);
  const nonAscii = bytes.some((byte) => byte > 0x7f);
  if (nonAscii) {
    failures.push(`[CMD] ${rel(file)}: 含非 ASCII 字符（cmd.exe 按系统代码页读取，会乱码）`);
  }
}

if (failures.length) {
  for (const line of failures) process.stderr.write(`${line}\n`);
  process.stderr.write(`\n检查失败：${failures.length} 处\n`);
  process.exit(1);
}

process.stdout.write(
  `检查通过：${jsFiles.length} JS / ${jsonFiles.length} JSON / ${ps1Files.length} PS1(BOM) / ${cmdFiles.length} CMD(ASCII)\n`
);
