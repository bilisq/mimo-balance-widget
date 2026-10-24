'use strict';

/**
 * 路径解析：JS 侧所有文件落点只在这里定义一次。
 *
 * 规则与 Python 侧 `whale.paths` 保持一致：
 *   --home / MIMO_WHALE_HOME / 平台默认目录
 * 唯一区别是平台默认值（Windows: %APPDATA%\MiMoWhale）。
 */

const path = require('node:path');
const os = require('node:os');

function defaultDataDir(options = {}) {
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const home = options.home || os.homedir();

  const override = String(env.MIMO_WHALE_HOME || '').trim();
  if (override) return path.resolve(override);

  if (platform === 'win32') {
    const base = env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(base, 'MiMoWhale');
  }
  const base = env.XDG_CONFIG_HOME || path.join(home, '.config');
  return path.join(base, 'mimowhale');
}

/**
 * @param {{appRoot?: string, env?: NodeJS.ProcessEnv, platform?: string, home?: string}} options
 */
function resolvePaths(options = {}) {
  const appRoot = options.appRoot;
  if (!appRoot) throw new Error('resolvePaths 需要 appRoot');

  const dataDir = defaultDataDir(options);
  const at = (...parts) => path.join(dataDir, ...parts);

  return {
    appRoot,
    dataDir,
    pythonDir: path.join(appRoot, 'python'),
    artworkDir: path.join(appRoot, 'artwork-nc'),
    assetsDir: path.join(appRoot, 'app', 'assets'),
    srcDir: path.join(appRoot, 'app', 'src'),
    preload: path.join(appRoot, 'app', 'preload.js'),
    indexHtml: path.join(appRoot, 'app', 'src', 'index.html'),
    autostartScript: path.join(appRoot, 'scripts', 'autostart.ps1'),
    config: at('config.json'),
    cache: at('cache.json'),
    ledger: at('ledger.json'),
    settings: at('settings.json'),
    autostartState: at('autostart.json'),
    // 安装位置指针与历史：只为了让"移动目录后的自启/命令行入口"能找回程序，
    // 程序自身的资源永远从 appRoot 相对解析。
    installPointer: at('pet-path.txt'),
    installRoots: at('pet-paths.json'),
    petsDir: at('pets'),
    logsDir: at('logs'),
    logFile: path.join(dataDir, 'logs', 'app.log'),
    binDir: at('bin'),
  };
}

module.exports = { defaultDataDir, resolvePaths };
