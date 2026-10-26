'use strict';

/**
 * 主进程入口。
 *
 * 只做编排，不含业务逻辑：
 *   路径/日志/设置 → 窗口/托盘/IPC → 数据服务（Python）→ 调度（Brain）
 *
 * 数据服务是"可失败"的：没有 Python、MiMo 没装、库不存在，挂件仍然可用，
 * 只是余额区显示不可用原因。这样别人 clone 下来双击也不会白屏。
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, nativeTheme, screen, shell } = require('electron');

const { resolvePaths } = require('./lib/paths');
const { createLogger } = require('./lib/logger');
const { SettingsStore } = require('./lib/settings');
const { readJson, writeJsonAtomic } = require('./lib/atomic');
const { findPython, probePython } = require('./lib/python');
const { Sidecar } = require('./lib/sidecar');
const { resolveTheme, readMimoTheme, MIMO_PREFS } = require('./lib/theme');
const { WindowController } = require('./lib/window');
const { createTray } = require('./lib/tray');
const { Autostart } = require('./lib/autostart');
const { Brain } = require('./lib/brain');
const { registerIpc } = require('./lib/ipc');

const SMOKE = process.argv.includes('--smoke-test');

if (SMOKE) app.disableHardwareAcceleration();
if (process.env.MIMO_WHALE_DISABLE_GPU === '1') app.disableHardwareAcceleration();

/**
 * 冒烟测试报告：写文件而不是只写 stdout。
 * 好处是 CI 可以把报告当 artifact 存下来，Windows 上 GUI 进程的 stdout
 * 也不一定被父进程接住。
 */
function smokeReportFile() {
  const base = process.env.MIMO_WHALE_HOME
    || (process.env.APPDATA ? path.join(process.env.APPDATA, 'MiMoWhale') : os.tmpdir());
  return path.join(base, 'smoke-report.json');
}

function writeSmoke(payload) {
  if (!SMOKE) return;
  const file = smokeReportFile();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ ...payload, at: new Date().toISOString() }, null, 2)}\n`, 'utf8');
  } catch {
    /* 报告写不出来不影响主流程 */
  }
}

/** 运行时状态（数据服务是懒启动的，界面可能先于它存在）。 */
const runtime = {
  appRoot: null,
  paths: null,
  logger: null,
  settings: null,
  geometry: null,
  sidecar: null,
  brain: null,
  windowController: null,
  tray: null,
  autostart: null,
  pythonInfo: null,
  themeTimer: null,
  configTimer: null,
  petCache: { dataUrl: null, mtimeMs: 0 },
  // 渲染层的真实错误（含 CSP 拦截）：冒烟测试据此判定"页面是否真的跑起来了"
  rendererErrors: [],
};

/**
 * 单实例：第二次启动只唤起已存在的窗口。
 * 冒烟测试不抢锁，免得用户桌面上正跑着一只时 CI 起不来。
 */
// Chromium 的 profile（GPU 缓存、Local Storage、Crashpad、Network）默认放在
// %APPDATA%\<app name>，而 app name 来自 productName（"MiMo 余额挂件"，含中文）。
// 有用户反馈放在中文目录下会闪退，profile 路径里的中文是同一类风险的来源，
// 所以这里固定成纯 ASCII 目录——与安装目录是否含中文无关。
const ASCII_USER_DATA = path.join(app.getPath('appData'), 'MiMoBalanceWidget');
app.setPath('userData', ASCII_USER_DATA);

const hasLock = SMOKE ? true : app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (runtime.windowController) runtime.windowController.show();
  });
}

// ---------------------------------------------------------------- 主题

function appDataDir() {
  return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
}

function currentTheme() {
  const prefsFile = path.join(appDataDir(), ...MIMO_PREFS);
  return resolveTheme({
    settingsTheme: runtime.settings ? runtime.settings.get().theme : 'auto',
    mimoTheme: readMimoTheme(prefsFile),
    shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
  });
}

function pushTheme() {
  const theme = currentTheme();
  if (runtime.windowController) runtime.windowController.send('theme', theme);
  return theme;
}

// ---------------------------------------------------------------- 安装位置记忆

/**
 * 程序自身的资源永远从 appRoot 相对解析；这里只维护"我在哪"的指针，
 * 供开机引导和命令行入口在目录搬移后找回程序。
 *
 * 写两份：
 *   pet-path.txt   单点指针（最新位置）
 *   pet-paths.json 最近 8 个位置的历史（搬移后引导脚本可以逐个尝试）
 */
function rememberInstallPath() {
  const { dataDir, installPointer, installRoots } = runtime.paths;
  const key = (value) => String(value).replace(/[\\/]+$/, '').toLowerCase();

  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(installPointer, runtime.appRoot, 'utf8');
  } catch (error) {
    runtime.logger.warn('paths.pointer', error);
  }

  try {
    const previous = readJson(installRoots, {});
    const list = Array.isArray(previous && previous.roots) ? previous.roots.filter((item) => typeof item === 'string') : [];
    const merged = [runtime.appRoot, ...list.filter((item) => key(item) !== key(runtime.appRoot))].slice(0, 8);
    writeJsonAtomic(installRoots, { roots: merged, updated: new Date().toISOString() });
  } catch (error) {
    runtime.logger.warn('paths.roots', error);
  }
}

// ---------------------------------------------------------------- 桌宠图

/**
 * 只在用户自定义贴图时走 IPC（返回 data URL）。
 * 预设皮肤由渲染层用相对路径直接加载，避免每次都把 MB 级图片塞进 IPC。
 *
 * settings 里只存文件名，这里按当前数据目录拼回绝对路径——
 * 数据目录搬走/换机器后依然能找到（自定义贴图跟着 APPDATA 走）。
 */
function petDataUrl() {
  const custom = runtime.settings.get().customImage;
  if (!custom) return null;
  const file = path.join(runtime.paths.petsDir, path.basename(custom));
  if (!fs.existsSync(file)) return null;
  try {
    const stat = fs.statSync(file);
    if (runtime.petCache.dataUrl && runtime.petCache.mtimeMs === stat.mtimeMs) return runtime.petCache.dataUrl;

    const image = nativeImage.createFromPath(file);
    if (image.isEmpty()) return null;
    const size = image.getSize();
    const scale = Math.min(1, 512 / Math.max(size.width, size.height));
    const resized = scale < 1 ? image.resize({ width: Math.round(size.width * scale), height: Math.round(size.height * scale) }) : image;
    const dataUrl = `data:image/png;base64,${resized.toPNG().toString('base64')}`;
    runtime.petCache = { dataUrl, mtimeMs: stat.mtimeMs };
    return dataUrl;
  } catch (error) {
    runtime.logger.warn('pet.image', error);
    return null;
  }
}

// ---------------------------------------------------------------- 数据层

function broadcastStatus() {
  const controller = runtime.windowController;
  if (!controller) return;
  controller.send('status', {
    sidecar: runtime.sidecar ? runtime.sidecar.status() : { state: 'unavailable', error: '未启动' },
    brain: runtime.brain ? runtime.brain.status() : null,
    python: runtime.pythonInfo,
  });
}

async function startDataLayer() {
  const { logger, paths } = runtime;

  // 探测解释器（同步但很快；放在窗口显示之后执行，不拖慢启动）
  const config = readJson(paths.config, {});
  const candidate = findPython({ env: process.env, config });
  const probe = probePython(candidate.exe);
  runtime.pythonInfo = {
    exe: candidate.exe,
    source: candidate.source,
    ok: !!probe.ok,
    version: probe.version || null,
    message: probe.ok ? null : probe.message,
    staleConfig: candidate.staleConfig || null,
  };
  if (!probe.ok) {
    logger.warn('python.probe', runtime.pythonInfo.message);
    broadcastStatus();
    return;
  }

  runtime.sidecar = new Sidecar({
    python: candidate.exe,
    pythonDir: paths.pythonDir,
    dataDir: paths.dataDir,
    logger,
  });
  runtime.sidecar.on('state', () => broadcastStatus());

  try {
    await runtime.sidecar.start();
    logger.info('sidecar.ready', runtime.sidecar.status());
  } catch (error) {
    logger.error('sidecar.start', error);
    broadcastStatus();
    return;
  }

  // config.json 里记录的 Python 路径可能来自另一台电脑（搬移/拷贝场景）。
  // 已经回落到可用解释器时，把正确路径写回去，下次启动就不用再猜。
  if (runtime.pythonInfo.staleConfig) {
    try {
      await runtime.sidecar.request('configure', { python: candidate.exe }, { timeout: 8000 });
      logger.info('python.reconfigured', { from: runtime.pythonInfo.staleConfig, to: candidate.exe });
      runtime.pythonInfo.staleConfig = null;
    } catch (error) {
      logger.warn('python.reconfigure', error);
    }
  }

  // 旧版留下的 whale.config.json 里可能是明文 Cookie：迁移并把明文抹掉。
  // 幂等，没有旧文件时是一条空操作。
  try {
    const migrated = await runtime.sidecar.request('migrate', {}, { timeout: 8000 });
    if (migrated && migrated.cookie) logger.info('credentials.migrated', migrated.cookie.store);
  } catch (error) {
    logger.warn('credentials.migrate', error);
  }

  const refreshSeconds = Number(config.refreshSeconds) || 60;
  runtime.brain = new Brain({
    sidecar: runtime.sidecar,
    settings: () => runtime.settings.get(),
    logger,
    refreshSeconds,
  });
  runtime.brain.on('snapshot', (payload) => {
    if (runtime.windowController) runtime.windowController.send('snapshot', payload);
  });
  runtime.brain.on('probe', (payload) => {
    if (runtime.windowController) runtime.windowController.send('probe', payload);
  });
  runtime.brain.on('status', () => broadcastStatus());
  runtime.brain.start();

  // 刷新间隔存在 Python 侧的 config.json 里（`whale configure` 也能改）。
  // 定时回读一次，改完不用重启就能生效——否则 Brain 会一直按旧间隔跑。
  runtime.configTimer = setInterval(() => {
    if (!runtime.brain) return;
    const latest = readJson(runtime.paths.config, {});
    const seconds = Number(latest.refreshSeconds);
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    if (seconds === runtime.brain.refreshSeconds) return;
    runtime.brain.setRefreshSeconds(seconds);
    logger.info('brain.refresh-interval', seconds);
  }, 30 * 1000);
  if (runtime.configTimer.unref) runtime.configTimer.unref();

  // 启动即取一次本地快照（不联网），让界面立刻有内容
  await runtime.brain.snapshot('boot');
  broadcastStatus();
}

// ---------------------------------------------------------------- 启动

async function bootstrap() {
  const appRoot = path.resolve(__dirname, '..');
  const nonAsciiPath = /[^\x00-\x7F]/.test(appRoot);
  writeSmoke({ phase: 'bootstrap', appRoot, asciiPath: !nonAsciiPath, argv: process.argv });
  runtime.appRoot = appRoot;
  runtime.paths = resolvePaths({ appRoot });
  fs.mkdirSync(runtime.paths.dataDir, { recursive: true });
  fs.mkdirSync(runtime.paths.logsDir, { recursive: true });

  const logger = createLogger(runtime.paths.logsDir);
  runtime.logger = logger;
  logger.info('app.start', { version: app.getVersion(), smoke: SMOKE, dataDir: runtime.paths.dataDir });
  logger.info('app.paths', { appRoot, userData: app.getPath('userData') });
  if (nonAsciiPath) {
    // 已知在部分环境下 Chromium 处理非 ASCII 安装路径会失败（闪退/白屏）。
    // 这里不阻止启动，但要留下能查的痕迹。
    logger.warn('app.non-ascii-path', `安装目录含非 ASCII 字符：${appRoot}（建议移动到纯英文路径）`);
  }

  runtime.settings = new SettingsStore(runtime.paths.settings, logger);
  runtime.geometry = await import('./shared/geometry.js');

  // 记录"程序在哪"：搬移目录后，开机引导和命令行入口靠它找回程序
  rememberInstallPath();

  runtime.autostart = new Autostart({
    script: runtime.paths.autostartScript,
    appRoot,
    dataDir: runtime.paths.dataDir,
    stateFile: runtime.paths.autostartState,
    logger,
  });

  runtime.windowController = new WindowController({
    BrowserWindow,
    screen,
    paths: runtime.paths,
    geometry: runtime.geometry,
    logger,
    onMoved: (point) => runtime.settings.save({ window: point }),
  });

  const win = runtime.windowController.create({ show: !SMOKE });
  runtime.windowController.restorePosition(runtime.settings.get().window);
  writeSmoke({ phase: 'window-created' });

  win.webContents.on('did-finish-load', () => {
    pushTheme();
    runtime.windowController.send('settings', runtime.settings.get());
  });

  runtime.tray = createTray({
    Tray,
    Menu,
    nativeImage,
    iconPath: path.join(runtime.paths.artworkDir, 'xiaomi.png'),
    isVisible: () => runtime.windowController.isVisible(),
    onToggle: () => runtime.windowController.toggle(),
    onRefresh: () => {
      if (runtime.brain) runtime.brain.refreshNow();
    },
    onSettings: () => {
      runtime.windowController.show();
      runtime.windowController.send('menu:open', null);
    },
    onOpenDataDir: () => shell.openPath(runtime.paths.dataDir),
    onOpenLog: () => shell.openPath(runtime.paths.logFile),
    onQuit: () => app.quit(),
  });

  registerIpc({
    ipcMain,
    app,
    shell,
    nativeImage,
    settings: runtime.settings,
    autostart: runtime.autostart,
    windowController: runtime.windowController,
    paths: runtime.paths,
    logger,
    getSidecar: () => runtime.sidecar,
    getBrain: () => runtime.brain,
    // 界面可能在数据层就绪前就发起请求（启动竞态）。
    // 与其直接报"数据服务未就绪"，不如等一小会儿。
    whenDataReady: () => runtime.dataReady || Promise.resolve(),
    getTheme: () => pushTheme(),
    getPetDataUrl: () => petDataUrl(),
    onRendererError: (message) => {
      runtime.rendererErrors.push(String(message).slice(0, 500));
      if (runtime.rendererErrors.length > 20) runtime.rendererErrors.shift();
    },
  });

  nativeTheme.on('updated', () => pushTheme());
  screen.on('display-removed', () => runtime.windowController.onDisplaysChanged());
  screen.on('display-metrics-changed', () => runtime.windowController.onDisplaysChanged());

  // MiMo 主题写在文件里，轮询比 fs.watch 更稳（文件可能被整体重写）
  runtime.themeTimer = setInterval(() => pushTheme(), 5000);

  // 目录搬移后修复自启快捷方式（失败不影响使用）
  runtime.autostart.repairIfEnabled().catch((error) => logger.warn('autostart.repair', error));

  // 让 IPC 能等到数据层就绪，避免界面启动时抢跑拿到"数据服务未就绪"
  let markDataReady = () => {};
  runtime.dataReady = new Promise((resolve) => { markDataReady = resolve; });

  await startDataLayer();
  markDataReady();
  writeSmoke({ phase: 'data-layer', sidecar: runtime.sidecar ? runtime.sidecar.status() : null });

  if (SMOKE) await runSmoke();
}

async function runSmoke() {
  const controller = runtime.windowController;
  const win = controller && controller.win;
  const report = { smoke: true, ok: false, checks: {}, sidecar: null, error: null };

  const timeout = setTimeout(() => {
    report.error = 'smoke 超时';
    finish(2);
  }, 30000);
  timeout.unref();

  const finish = (code) => {
    clearTimeout(timeout);
    writeSmoke({ phase: 'done', exitCode: code, ...report });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    app.exit(code);
  };

  try {
    if (!win) throw new Error('窗口未创建');
    await new Promise((resolve) => {
      if (!win.webContents.isLoading()) return resolve();
      win.webContents.once('did-finish-load', resolve);
      return undefined;
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const dom = await win.webContents.executeJavaScript(`(() => {
      const api = window.whale || null;
      return {
        hasApi: !!api,
        apiKeys: api ? Object.keys(api).sort() : [],
        hasPet: !!document.getElementById('pet'),
        hasPanel: !!document.getElementById('panel'),
        hasMenu: !!document.getElementById('menu'),
        ready: document.body.dataset.ready || '',
        title: document.title,
      };
    })()`);

    // 真的点一下菜单按钮 / 右键桌宠，确认"能打开"——静态检查抓不到事件接线错误。
    const ui = await win.webContents.executeJavaScript(`(async () => {
      const menu = document.getElementById('menu');
      const pet = document.getElementById('pet');
      const button = document.querySelector('.menu-button');
      const style = button ? getComputedStyle(button) : null;
      const before = menu ? menu.hidden : null;

      if (button) button.click();
      else if (pet) pet.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 250));

      const opened = menu ? !menu.hidden : false;
      const rect = menu ? menu.getBoundingClientRect() : { width: 0, height: 0 };

      // 打开后立刻关掉，避免影响后续断言
      if (menu && opened) menu.hidden = true;

      return {
        hasButton: !!button,
        buttonOpacity: style ? style.opacity : null,
        buttonPointerEvents: style ? style.pointerEvents : null,
        menuHiddenBefore: before,
        menuOpened: opened,
        menuWidth: Math.round(rect.width),
        menuHeight: Math.round(rect.height),
      };
    })()`);

    report.ui = ui;

    // 点击穿透：渲染层按几何判定切"捕获/穿透"，这段链路（渲染层→preload→IPC→窗口）
    // 是程序调用测不到的盲区——曾经因为 api.js 少暴露一个方法，宠物变成点不动。
    const click = await win.webContents.executeJavaScript(`(async () => {
      const pet = document.getElementById('whale');
      const rect = pet ? pet.getBoundingClientRect() : null;
      const center = rect
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : { x: 8, y: 8 };
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      window.dispatchEvent(new MouseEvent('mousemove', { clientX: center.x, clientY: center.y, bubbles: true }));
      await wait(150);
      const onPet = document.body.dataset.mouseCapture || '';

      // 浮层（这里是上一步打开过的菜单）打开期间，鼠标移到空白处也应该保持捕获，
      // 否则空白点击收不到，"点空白关闭浮层"就不成立。
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 2, clientY: 2, bubbles: true }));
      await wait(150);
      const heldWhileOpen = document.body.dataset.mouseCapture || '';

      // 用真实的关闭路径：在空白处按下 → 浮层关闭 → 恢复穿透
      const blank = document.body;
      blank.dispatchEvent(new MouseEvent('pointerdown', { clientX: 2, clientY: 2, bubbles: true }));
      blank.dispatchEvent(new MouseEvent('click', { clientX: 2, clientY: 2, bubbles: true }));
      await wait(150);
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 2, clientY: 2, bubbles: true }));
      await wait(150);
      const onBlank = document.body.dataset.mouseCapture || '';

      return {
        onPet,
        heldWhileOpen,
        onBlank,
        petRect: rect ? { w: Math.round(rect.width), h: Math.round(rect.height) } : null,
      };
    })()`);

    report.mouse = click;
    const ignoreCalls = (runtime.windowController && runtime.windowController.ignoreCalls) || 0;

    report.checks = {
      windowCreated: true,
      rendererLoaded: dom.ready === '1',
      apiExposed: dom.hasApi,
      domReady: dom.hasPet && dom.hasPanel && dom.hasMenu,
      menuOpens: !!ui.menuOpened,
      mouseCaptureOnPet: click.onPet === '1',
      // 浮层开着时保持捕获（"点空白关闭"的前提）
      mouseHeldWhileOverlayOpen: click.heldWhileOpen === '1',
      mouseCaptureOffBlank: click.onBlank === '0',
      mouseIgnoreWired: ignoreCalls > 0,
      title: dom.title,
    };
    report.sidecar = runtime.sidecar ? runtime.sidecar.status() : null;
    report.rendererErrors = runtime.rendererErrors;
    report.ok = !!(
      report.checks.rendererLoaded
      && report.checks.apiExposed
      && report.checks.domReady
      && report.checks.menuOpens
      && report.checks.mouseCaptureOnPet
      && report.checks.mouseHeldWhileOverlayOpen
      && report.checks.mouseCaptureOffBlank
      && report.checks.mouseIgnoreWired
      && runtime.rendererErrors.length === 0
    );
    finish(report.ok ? 0 : 1);
  } catch (error) {
    report.error = error && error.message ? error.message : String(error);
    if (runtime.logger) runtime.logger.error('smoke', error);
    finish(1);
  }
}

if (hasLock) {
  app.whenReady().then(bootstrap).catch((error) => {
    // 启动阶段异常：写日志（如果可用）后退出，避免留下无窗口的僵尸进程
    if (runtime.logger) runtime.logger.error('bootstrap', error);
    // eslint-disable-next-line no-console
    console.error(error);
    app.exit(1);
  });
}

// 托盘常驻：窗口被关掉（渲染崩溃、异常 close）不应该带走整个进程，
// 否则托盘图标还在、点它却毫无反应。这里只记日志，重建交给 windowController。
// 真正退出只由托盘/菜单里的"退出"触发（app.quit()）。
app.on('window-all-closed', () => {
  if (runtime.logger) runtime.logger.warn('window.all-closed', '窗口已全部关闭，保留托盘常驻');
});

app.on('before-quit', () => {
  if (runtime.themeTimer) clearInterval(runtime.themeTimer);
  if (runtime.configTimer) clearInterval(runtime.configTimer);
  if (runtime.sidecar) runtime.sidecar.stop();
  if (runtime.logger) runtime.logger.info('app.quit');
});

process.on('uncaughtException', (error) => {
  if (runtime.logger) runtime.logger.error('uncaughtException', error);
});
process.on('unhandledRejection', (reason) => {
  if (runtime.logger) runtime.logger.error('unhandledRejection', reason);
});
