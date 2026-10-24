'use strict';

/**
 * 可移植性回归测试：防止有人（包括我自己）把本机绝对路径写进源码。
 *
 * 规则：程序资源必须从 __dirname / $PSScriptRoot / __file__ 相对解析；
 * 只有"数据目录、日志、解释器"这类本机状态允许是绝对路径，而且
 * 它们必须由 APPDATA / MIMO_WHALE_HOME / 运行时探测得到，不能是字面量。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ROOT } = require('./helpers');

const SCAN_DIRS = ['app', 'python/whale', 'scripts', 'skill'];
const SCAN_FILES = ['setup.ps1', 'setup.cmd', 'start.cmd', 'package.json'];
const SKIP = [/node_modules/, /[\\/]\.tmp/, /__pycache__/, /[\\/]artwork-nc/];

const FORBIDDEN = [
  { pattern: /[A-Za-z]:\\/, reason: '盘符绝对路径' },
  { pattern: /\/Users\/[A-Za-z0-9._-]+/, reason: 'macOS 用户目录' },
  { pattern: /\/home\/[A-Za-z0-9._-]+/, reason: 'Linux 用户目录' },
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (SKIP.some((pattern) => pattern.test(full))) continue;
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = [
  ...SCAN_DIRS.flatMap((dir) => walk(path.join(ROOT, dir))),
  ...SCAN_FILES.map((file) => path.join(ROOT, file)),
].filter((file) => fs.existsSync(file) && fs.statSync(file).isFile());

test('源码里没有写死的绝对路径', () => {
  const hits = [];
  for (const file of files) {
    if (!/\.(js|mjs|py|ps1|cmd|json|md|html|css)$/.test(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const rule of FORBIDDEN) {
        if (rule.pattern.test(line)) {
          hits.push(`${path.relative(ROOT, file)}:${index + 1} [${rule.reason}] ${line.trim()}`);
        }
      }
    });
  }
  assert.deepEqual(hits, [], `发现绝对路径，请改为相对解析或运行时探测：\n${hits.join('\n')}`);
});

test('Chromium profile 目录固定在 ASCII 路径下', () => {
  // productName 是中文（"MiMo 余额挂件"），默认 userData 会变成
  // %APPDATA%\MiMo 余额挂件。Chromium 对非 ASCII profile 路径处理不完整，
  // 有用户反馈会闪退——所以显式改到纯 ASCII 目录。
  const main = fs.readFileSync(path.join(ROOT, 'app', 'main.js'), 'utf8');
  assert.match(main, /app\.setPath\('userData'/, '应显式设置 userData');
  assert.match(main, /'MiMoBalanceWidget'/, 'userData 目录名必须是纯 ASCII');
  const userDataLine = main.split('\n').find((line) => line.includes("setPath('userData'")) || '';
  assert.ok(!/[^\x00-\x7F]/.test(userDataLine), `userData 路径不应含非 ASCII：${userDataLine}`);
});

test('start.cmd 会去掉 %~dp0 的尾反斜杠', () => {
  // %~dp0 以 \ 结尾。带引号传给 start 时，CommandLineToArgvW 会把 "\" 当成
  // 转义，子进程收到的路径末尾多一个引号 → 找不到 package.json → 双击没反应。
  // 重写时丢过一次，这里守着。
  const cmd = fs.readFileSync(path.join(ROOT, 'start.cmd'), 'utf8');
  assert.match(
    cmd,
    /if "%PETDIR:~-1%"=="\\" set "PETDIR=%PETDIR:~0,-1%"/,
    'start.cmd 必须去掉 %~dp0 的尾反斜杠'
  );
  assert.match(cmd, /start "" "%ELECTRON%" "%PETDIR%"/, '启动时应传去尾斜杠后的 PETDIR');
  assert.ok(!/start "" "%ELECTRON%" "%~dp0"/.test(cmd), '不能把带尾斜杠的 %~dp0 直接传给 start');
  assert.match(cmd, /if not exist "%PETDIR%\\app\\main\.js"/, '应检查 app\\main.js 是否存在，避免静默失败');
});

test('命令行入口在运行时解析仓库位置（不固化 PYTHONPATH）', () => {
  const setup = fs.readFileSync(path.join(ROOT, 'setup.ps1'), 'utf8');
  assert.match(setup, /pet-path\.txt/, '入口应读取 pet-path.txt 来定位仓库');
  assert.match(setup, /__REPO_FALLBACK__/, '入口应保留安装时记录的兜底路径');
  assert.match(setup, /config\.json/, '入口应从 config.json 读取 Python 路径');
});

test('开机引导能从位置历史里找回程序', () => {
  const autostart = fs.readFileSync(path.join(ROOT, 'scripts', 'autostart.ps1'), 'utf8');
  assert.match(autostart, /pet-paths\.json/, '引导应读取位置历史');
  assert.match(autostart, /pet-path\.txt/, '引导应读取单点指针');
  assert.match(autostart, /Test-AppRoot/, '引导应校验候选路径是否真的是安装目录');
});

test('主进程会维护位置指针并纠正失效的 Python 路径', () => {
  const main = fs.readFileSync(path.join(ROOT, 'app', 'main.js'), 'utf8');
  assert.match(main, /installPointer|pet-path\.txt/, '主进程应写入位置指针');
  assert.match(main, /installRoots/, '主进程应维护位置历史');
  assert.match(main, /staleConfig/, '主进程应纠正失效的 Python 路径');
});

test('Python 探测会校验 config 里的路径是否存在', () => {
  const source = fs.readFileSync(path.join(ROOT, 'app', 'lib', 'python.js'), 'utf8');
  assert.match(source, /staleConfig/, 'findPython 应返回 staleConfig 供上层纠正');
  assert.match(source, /exists\(/, 'findPython 应校验候选路径存在性');
});
