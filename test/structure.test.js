'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function readVersion(file, pattern) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const match = text.match(pattern);
  assert.ok(match, `${file} 里找不到版本号`);
  return match[1];
}

test('package.json 与 Python 包版本一致', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const pythonVersion = readVersion('python/whale/__init__.py', /__version__\s*=\s*"([^"]+)"/);
  assert.equal(pythonVersion, pkg.version, '改版本号时 package.json 和 python/whale/__init__.py 必须同步');
});

test('快照 schema 版本一致', () => {
  const schema = Number(readVersion('python/whale/__init__.py', /SCHEMA\s*=\s*(\d+)/));
  const summarySchema = Number(readVersion('python/whale/summary.py', /^SCHEMA\s*=\s*(\d+)/m));
  assert.equal(summarySchema, schema, 'python/whale/summary.py 的 SCHEMA 必须与 __init__.py 一致');
});

test('渲染层引用的皮肤文件都存在', () => {
  const candidates = [
    'artwork-nc/xiaomi.png',
    'artwork-nc/xiaoai.png',
    'artwork-nc/xiaoai-dark.png',
    'app/assets/whale-tight.png',
  ];
  for (const file of candidates) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `缺少资源：${file}`);
  }
});

test('技能描述文件存在且带 frontmatter', () => {
  const skill = fs.readFileSync(path.join(ROOT, 'skill/mimo-balance-whale/SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: mimo-balance-whale/);
});

test('启动器源码与构建脚本齐全，且发布包会带上它', () => {
  const source = path.join(ROOT, 'scripts/launcher/Program.cs');
  const build = path.join(ROOT, 'scripts/build-launcher.ps1');
  assert.ok(fs.existsSync(source), '缺少启动器源码 scripts/launcher/Program.cs');
  assert.ok(fs.existsSync(build), '缺少构建脚本 scripts/build-launcher.ps1');

  const code = fs.readFileSync(source, 'utf8');
  assert.match(code, /node_modules\\electron\\dist\\electron\.exe/, '启动器应查找同目录的 electron.exe');
  assert.match(code, /ELECTRON_RUN_AS_NODE/, '启动器应清掉可能污染的环境变量');
  assert.match(code, /--trace/, '应提供非交互的诊断模式，便于自动化排查');

  const release = fs.readFileSync(path.join(ROOT, 'scripts/package-release.ps1'), 'utf8');
  assert.match(release, /build-launcher\.ps1/, '发布包应在打包时编译启动器');
});
