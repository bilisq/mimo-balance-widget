'use strict';

/**
 * 渲染层静态检查：不需要真正跑 Electron 也能抓住最常见的集成错误——
 * 引用了不存在的元素 id、import 路径写错、显示项开关与设置模型对不上。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ROOT } = require('./helpers');
const { DISPLAY_KEYS } = require('../app/lib/settings');

const SRC = path.join(ROOT, 'app', 'src');
const JS_DIR = path.join(SRC, 'js');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

const html = read(path.join(SRC, 'index.html'));
const htmlIds = new Set(Array.from(html.matchAll(/\bid="([^"]+)"/g), (match) => match[1]));
const rendererFiles = fs.readdirSync(JS_DIR).filter((name) => name.endsWith('.js') && name !== 'package.json');

test('index.html 里的 id 唯一', () => {
  const all = Array.from(html.matchAll(/\bid="([^"]+)"/g), (match) => match[1]);
  assert.equal(new Set(all).size, all.length, '存在重复的 id');
});

test('渲染层引用的每个 #id 都存在于 index.html', () => {
  const missing = [];
  for (const name of rendererFiles) {
    const source = read(path.join(JS_DIR, name));
    for (const match of source.matchAll(/['"]#([a-zA-Z][\w-]*)['"]/g)) {
      if (!htmlIds.has(match[1])) missing.push(`${name}: #${match[1]}`);
    }
  }
  assert.deepEqual(missing, [], `以下元素在 HTML 里不存在：\n${missing.join('\n')}`);
});

test('渲染层的相对 import 都能解析', () => {
  const missing = [];
  for (const name of rendererFiles) {
    const file = path.join(JS_DIR, name);
    const source = read(file);
    for (const match of source.matchAll(/from\s+'([^']+)'/g)) {
      const spec = match[1];
      if (!spec.startsWith('.')) continue;
      const resolved = path.resolve(path.dirname(file), spec);
      if (!fs.existsSync(resolved)) missing.push(`${name}: ${spec}`);
    }
  }
  assert.deepEqual(missing, [], `以下模块不存在：\n${missing.join('\n')}`);
});

/** 收集一个模块声明的导出名（够用即可，不做完整 AST）。 */
function exportsOf(source) {
  const names = new Set();
  for (const m of source.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of source.matchAll(/export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of source.matchAll(/export\s+class\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const alias = part.trim().split(/\s+as\s+/).pop();
      if (alias && alias.trim()) names.add(alias.trim());
    }
  }
  return names;
}

test('import 的具名符号在目标模块里确实有导出', () => {
  // 真实踩过：dom.js 少导出 clear，浏览器直接 SyntaxError，整个渲染层白屏，
  // 而主进程看起来一切正常。这条静态检查比启动后看白屏便宜得多。
  const missing = [];
  for (const name of rendererFiles) {
    const file = path.join(JS_DIR, name);
    const source = read(file);
    for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
      const spec = match[2];
      if (!spec.startsWith('.')) continue;
      const target = path.resolve(path.dirname(file), spec);
      if (!fs.existsSync(target)) continue; // 路径存在性由上一个测试负责
      const available = exportsOf(read(target));
      for (const raw of match[1].split(',')) {
        const imported = raw.trim().split(/\s+as\s+/)[0].trim();
        if (!imported) continue;
        if (!available.has(imported)) missing.push(`${name}: ${imported} 未在 ${spec} 中导出`);
      }
    }
  }
  assert.deepEqual(missing, [], `以下具名导入不存在：\n${missing.join('\n')}`);
});

test('显示项开关与设置模型一致', () => {
  const keys = new Set(DISPLAY_KEYS);
  const inHtml = new Set(Array.from(html.matchAll(/data-opt="([^"]+)"/g), (match) => match[1]));
  assert.deepEqual([...inHtml].sort(), [...keys].sort(), 'HTML 的 data-opt 与 settings.DISPLAY_KEYS 必须一一对应');
});

test('CSP 没有放开 inline script', () => {
  const csp = html.match(/Content-Security-Policy"\s+content="([^"]+)"/);
  assert.ok(csp, 'index.html 缺少 CSP');
  assert.ok(!/script-src[^;]*unsafe-inline/.test(csp[1]), 'script-src 不应包含 unsafe-inline');
  assert.ok(!/script-src[^;]*unsafe-eval/.test(csp[1]), 'script-src 不应包含 unsafe-eval');
});

test('渲染层调用的 api.<组>.<方法> 都在 api.js 里暴露了', () => {
  // 真实踩过：clickthrough.js 调 api.window.setMouseIgnore()，
  // 但 api.js 的 window 分组里没有这个方法 → 抛异常 → 宠物变成点不动，
  // 而主进程侧一切正常，smoke 的程序化点击也发现不了。
  const apiSource = read(path.join(JS_DIR, 'api.js'));
  const groups = {};
  let current = null;
  for (const line of apiSource.split('\n')) {
    const open = line.match(/^  ([A-Za-z_$][\w$]*): \{/);
    if (open) { current = open[1]; groups[current] = new Set(); continue; }
    if (/^  \},?$/.test(line)) { current = null; continue; }
    if (current) {
      const member = line.match(/^    ([A-Za-z_$][\w$]*):/);
      if (member) groups[current].add(member[1]);
    }
  }

  const missing = [];
  for (const name of rendererFiles) {
    const source = read(path.join(JS_DIR, name));
    for (const match of source.matchAll(/\bapi\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*\(/g)) {
      const [, group, method] = match;
      if (!groups[group]) { missing.push(`${name}: api.${group} 分组不存在`); continue; }
      if (!groups[group].has(method)) missing.push(`${name}: api.${group}.${method} 未在 api.js 暴露`);
    }
  }
  assert.deepEqual(missing, [], `以下调用没有对应的接口实现：\n${missing.join('\n')}`);
});

test('渲染层没有把 innerHTML 当模板用', () => {
  const offenders = [];
  for (const name of rendererFiles) {
    const source = read(path.join(JS_DIR, name));
    if (/\.innerHTML\s*=/.test(source)) offenders.push(name);
  }
  assert.deepEqual(offenders, [], `这些文件用了 innerHTML，应改为 textContent / DOM 构建：${offenders.join(', ')}`);
});

test('气泡 5 秒自动消失，且点击/失焦可关闭', () => {
  const toast = read(path.join(JS_DIR, 'toast.js'));
  assert.match(toast, /BUBBLE_TTL_MS\s*=\s*5000/, '气泡自动消失时间应为 5 秒');
  assert.match(toast, /show\('idle', children, BUBBLE_TTL_MS\)/, 'idle 气泡应使用 5 秒 TTL');
  assert.match(toast, /show\('turn', \[title, line1, line2\], BUBBLE_TTL_MS\)/, 'turn 气泡应使用 5 秒 TTL');

  const app = read(path.join(JS_DIR, 'app.js'));
  assert.match(app, /createToast\(\{\s*onChange/, 'app.js 应向 createToast 传入 onChange');
  assert.match(app, /addEventListener\('click', dismissBubble/, '缺少"点击任意处关闭气泡"');
  assert.match(app, /addEventListener\('blur'[\s\S]{0,220}dismissBubble\(\)/, '窗口失焦时应关闭气泡');

  const click = read(path.join(JS_DIR, 'clickthrough.js'));
  assert.match(click, /function setHold/, 'clickthrough 应提供 setHold（浮层/气泡可见时临时捕获鼠标）');
});

test('余额面板（气泡）5 秒自动关闭，且点空白处可关', () => {
  const app = read(path.join(JS_DIR, 'app.js'));
  assert.match(app, /function armOverlayTimer|const armOverlayTimer/, '缺少浮层自动关闭计时器');
  assert.match(app, /setTimeout\(\(\) => \{[\s\S]{0,120}\}, 5000\)/, '浮层自动关闭应为 5 秒');
  assert.match(app, /panel\.isOpen\(\) && !inside\('#panel'\)/, '点击面板外应关闭面板');
  assert.match(app, /panelEl\.addEventListener\('mouseenter', clearOverlayTimer\)/, '鼠标停在面板上应暂停计时');
  assert.match(app, /panel\.isOpen\(\)\) panel\.close\(\)/, '计时结束应关闭面板');
});

test('可见的菜单按钮必须绑定事件（不能是死的）', () => {
  // 真实踩过：☰ 按钮有样式、有 hover 效果，但没有任何 click 监听，
  // 点了完全没反应——静态检查当时也没发现。
  const app = read(path.join(JS_DIR, 'app.js'));
  assert.match(app, /#menu-button/, 'app.js 里没有给 #menu-button 绑事件');
  assert.match(app, /menu\.open\(\)/, '菜单按钮应能打开菜单');

  const html = read(path.join(SRC, 'index.html'));
  assert.match(html, /id="menu-button"/, 'HTML 里应有菜单按钮');
});
