'use strict';

/**
 * IPC 层：渲染层与主进程之间唯一的接口面。
 *
 * 约定：
 * - 通道名用 `域:动作`；invoke 返回数据，失败返回 `{ok:false, error}`；
 * - 每个入参都过 validate.js，脏值不进配置文件；
 * - 任何 handler 抛错都不会让主进程崩，只把错误回给界面并记日志；
 * - 数据服务（sidecar）是懒启动的，所以通过 getter 取，而不是构造时注入。
 */

const fs = require('node:fs');
const path = require('node:path');
const v = require('./validate');
const update = require('./update');
const { readJson } = require('./atomic');

const CONSOLE_URL = 'https://platform.xiaomimimo.com/#/console/balance';
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_PET_SIDE = 720;
const ALLOWED_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);

function registerIpc(deps) {
  const {
    ipcMain,
    shell,
    app,
    nativeImage,
    settings,
    autostart,
    windowController,
    paths,
    logger,
    getSidecar,
    getBrain,
    whenDataReady,
    getTheme,
    getPetDataUrl,
  } = deps;

  const fail = (code, message) => ({ ok: false, error: { code, message } });

  const fromMainWindow = (event) => {
    const contents = windowController.webContents;
    return !!contents && event.sender.id === contents.id;
  };

  function handle(channel, fn) {
    ipcMain.handle(channel, async (event, payload) => {
      if (!fromMainWindow(event)) {
        logger.warn('ipc.sender', `${channel} 来自未知渲染进程，已拒绝`);
        return fail('FORBIDDEN', '非法调用来源');
      }
      try {
        return await fn(payload, event);
      } catch (error) {
        logger.error(`ipc.${channel}`, error);
        return fail(error && error.code ? error.code : 'INTERNAL', (error && error.message) || String(error));
      }
    });
  }

  function on(channel, fn) {
    ipcMain.on(channel, (event, payload) => {
      if (!fromMainWindow(event)) return;
      try {
        fn(payload, event);
      } catch (error) {
        logger.error(`ipc.${channel}`, error);
      }
    });
  }

  const sidecarRequest = async (cmd, args, options) => {
    const sidecar = getSidecar();
    if (!sidecar) {
      throw Object.assign(new Error('数据服务未就绪：请运行 setup.cmd 检查 Python 环境'), { code: 'SIDECAR_UNAVAILABLE' });
    }
    return sidecar.request(cmd, args, options);
  };

  const brainOrThrow = () => {
    const brain = getBrain();
    if (!brain) throw Object.assign(new Error('数据服务未就绪'), { code: 'SIDECAR_UNAVAILABLE' });
    return brain;
  };

  // ------------------------------------------------------------ 应用信息
  handle('app:info', () => {
    const sidecar = getSidecar();
    return {
      version: app.getVersion(),
      electron: process.versions.electron,
      node: process.versions.node,
      chrome: process.versions.chrome,
      platform: process.platform,
      arch: process.arch,
      dataDir: paths.dataDir,
      sidecar: sidecar ? sidecar.status() : { state: 'unavailable', error: '未启动' },
    };
  });

  // ------------------------------------------------------------ 设置
  handle('settings:get', () => settings.get());
  handle('settings:save', (payload) => settings.save(payload && typeof payload === 'object' ? payload : {}));

  // ------------------------------------------------------------ Cookie
  handle('cookie:save', async (payload) => {
    const cookie = v.asString(payload, '', 8192);
    if (!cookie.trim()) return fail('COOKIE_INVALID', 'Cookie 不能为空');
    const saved = await sidecarRequest('set-cookie', { cookie }, { timeout: 15000 });
    const brain = getBrain();
    if (brain) {
      brain.resume();
      brain.lastRefreshAt = 0;
      brain.refreshNow();
    }
    const store = (saved && saved.store) || 'unknown';
    return {
      ok: true,
      store,
      encrypted: store === 'dpapi',
      message: store === 'dpapi' ? 'Cookie 已加密保存（DPAPI）' : 'Cookie 已保存（明文，建议重新保存以加密）',
    };
  });

  // ------------------------------------------------------------ 桌宠贴图
  handle('pet:image:get', () => {
    const custom = settings.get().customImage;
    return { dataUrl: custom ? getPetDataUrl() : null, custom: !!custom };
  });

  handle('pet:image:save', (payload) => {
    const raw = payload && payload.buffer;
    const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw || []);
    if (!bytes.length) return fail('IMAGE_INVALID', '没有收到图片数据');
    if (bytes.length > MAX_IMAGE_BYTES) return fail('IMAGE_TOO_LARGE', '图片超过 8 MB');

    const name = v.asString(payload && payload.name, 'custom.png', 260);
    const ext = (path.extname(name).slice(1) || 'png').toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return fail('IMAGE_INVALID', '只支持 png / jpg / webp / gif');

    const image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) return fail('IMAGE_INVALID', '无法识别的图片文件');

    const size = image.getSize();
    const scale = Math.min(1, MAX_PET_SIDE / Math.max(size.width, size.height));
    const resized = scale < 1 ? image.resize({ width: Math.round(size.width * scale), height: Math.round(size.height * scale) }) : image;
    const png = resized.toPNG();

    fs.mkdirSync(paths.petsDir, { recursive: true });
    for (const entry of fs.readdirSync(paths.petsDir)) {
      if (!entry.startsWith('custom.')) continue;
      try {
        fs.unlinkSync(path.join(paths.petsDir, entry));
      } catch {
        /* 忽略 */
      }
    }
    fs.writeFileSync(path.join(paths.petsDir, 'custom.png'), png);
    // 只记文件名：数据目录搬走/换机器后仍能找回（见 main.js 的 petDataUrl）
    settings.save({ customImage: 'custom.png' });

    return { ok: true, dataUrl: `data:image/png;base64,${png.toString('base64')}`, name };
  });

  handle('pet:image:reset', () => {
    settings.save({ customImage: null });
    return { ok: true };
  });

  // ------------------------------------------------------------ 会话
  handle('sessions:list', async () => {
    const data = await sidecarRequest('sessions', { limit: 15 }, { timeout: 10000 });
    return { ok: true, sessions: (data && data.sessions) || [] };
  });

  handle('session:pin', (payload) => {
    const id = payload === null || payload === undefined || payload === '' ? null : v.asString(payload, '', 200) || null;
    const next = settings.save({ sessionId: id });
    const brain = getBrain();
    if (brain) {
      brain.lastStopTs = 0;
      brain.lastCount = -1;
      brain.refreshNow();
    }
    return { ok: true, settings: next };
  });

  // ------------------------------------------------------------ 数据
  handle('data:snapshot', async () => {
    if (whenDataReady) await whenDataReady();
    return sidecarRequest('snapshot', { session: settings.get().sessionId }, { timeout: 8000 });
  });

  handle('data:refresh', async () => {
    // 界面启动时可能比数据层快一步：等它就绪，而不是直接抛"未就绪"
    if (whenDataReady) await whenDataReady();
    const data = await brainOrThrow().refreshNow();
    if (!data) {
      const status = getBrain().status();
      return fail('REFRESH_FAILED', (status.error && status.error.message) || '刷新失败');
    }
    return data;
  });

  // ------------------------------------------------------------ 主题
  handle('theme:get', () => getTheme());

  // ------------------------------------------------------------ 自启
  handle('autostart:get', () => autostart.status());

  handle('autostart:set', async (payload) => {
    const enabled = v.asBoolean(payload, false);
    const result = enabled ? await autostart.enable() : await autostart.disable();
    return { ...result, status: autostart.status() };
  });

  // ------------------------------------------------------------ 诊断
  handle('diagnostics', async () => {
    const info = {
      app: {
        version: app.getVersion(),
        electron: process.versions.electron,
        node: process.versions.node,
        platform: process.platform,
        arch: process.arch,
      },
      paths: {
        appRoot: paths.appRoot,
        dataDir: paths.dataDir,
        config: paths.config,
        settings: paths.settings,
        log: paths.logFile,
      },
      autostart: autostart.status(),
    };
    const sidecar = getSidecar();
    const brain = getBrain();
    info.sidecar = sidecar ? sidecar.status() : { state: 'unavailable' };
    info.brain = brain ? brain.status() : null;
    try {
      info.python = await sidecarRequest('diagnose', {}, { timeout: 10000 });
    } catch (error) {
      info.python = { ok: false, error: error.code || 'DIAGNOSE_FAILED', message: error.message };
    }
    return info;
  });

  // ------------------------------------------------------------ 更新检查（手动触发）
  handle('update:check', () => {
    const pkg = readJson(path.join(paths.appRoot, 'package.json'), {});
    return update.checkForUpdate({
      currentVersion: app.getVersion(),
      slug: update.parseRepoSlug(pkg),
    });
  });

  // ------------------------------------------------------------ 系统操作
  handle('shell:open', async (payload) => {
    const target = v.asString(payload, '', 32);
    if (target === 'console') {
      await shell.openExternal(CONSOLE_URL);
      return { ok: true };
    }
    if (target === 'releases') {
      // 仓库地址还没替换成真实值时，给一句人话，而不是打开一个 404
      const pkg = readJson(path.join(paths.appRoot, 'package.json'), {});
      const slug = update.parseRepoSlug(pkg);
      if (!slug) return fail('UNCONFIGURED', '还没有配置仓库地址（package.json 的 repository）');
      await shell.openExternal(update.releasesUrl(slug));
      return { ok: true };
    }
    const map = {
      data: paths.dataDir,
      logs: paths.logsDir,
      readme: path.join(paths.appRoot, 'README.md'),
    };
    const file = map[target];
    if (!file) return fail('BAD_TARGET', '不支持的目标');
    const error = await shell.openPath(file);
    return error ? fail('OPEN_FAILED', error) : { ok: true };
  });

  // ------------------------------------------------------------ 窗口
  handle('window:geometry', () => windowController.getBounds() || { x: 0, y: 0, width: 0, height: 0 });

  on('window:move', (payload) => {
    const point = v.asPoint(payload);
    if (point) windowController.moveTo(point);
  });
  on('window:snap', () => windowController.snapToEdge());
  on('app:hide', () => windowController.hide());
  on('app:quit', () => app.quit());

  ipcMain.on('renderer:error', (event, payload) => {
    if (!fromMainWindow(event)) return;
    const message = payload && (payload.stack || payload.message);
    logger.error('renderer.error', message);
    if (deps.onRendererError) deps.onRendererError(message);
  });
}

module.exports = { registerIpc, CONSOLE_URL, MAX_IMAGE_BYTES, MAX_PET_SIDE };
