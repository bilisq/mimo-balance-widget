'use strict';

/**
 * 检查更新（非常轻量）。
 *
 * 为什么不用 electron-updater：
 * - 我们的分发方式是**免安装的 zip**，而 electron-updater 面向 NSIS/Squirrel 安装包，
 *   在解压目录上做增量更新需要 electron-builder 的打包配置 + 代码签名；
 * - 对于个人项目，签名的证书成本与"静默替换正在运行的文件"的风险都不划算。
 *
 * 所以这里只做"发现新版本"，由用户点一下按钮触发，不后台轮询、不上报任何东西。
 * 想做成全自动的话，前提是先把分发方式换成安装包并签名。
 */

const DEFAULT_TIMEOUT = 8000;

function releasesUrl(slug) {
  return `https://github.com/${slug.owner}/${slug.repo}/releases`;
}

/**
 * 从 package.json 的 repository 解析 GitHub owner/repo。
 * 返回 null 表示"没配置"或"还是占位符"，调用方应当提示用户而不是报网络错误。
 */
function parseRepoSlug(pkg) {
  const repository = pkg && pkg.repository;
  const raw = String(
    (repository && (repository.url || repository)) || (pkg && pkg.homepage) || ''
  ).trim();
  if (!raw) return null;
  const match = raw.match(/github\.com[/:]([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[/#?].*)?$/i);
  if (!match) return null;
  const owner = match[1];
  const repo = match[2];
  if (/^(your-name|example|user|owner)$/i.test(owner)) return null;
  return { owner, repo };
}

/** 'v1.2.3' / '1.2.3-beta' → [1,2,3]；无法解析返回 null。 */
function parseVersion(text) {
  const match = String(text || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)/i);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** 只比较 major.minor.patch，预发布标签忽略（个人项目够用）。 */
function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
}

/**
 * @param {{
 *   currentVersion: string,
 *   slug: {owner: string, repo: string}|null,
 *   fetchImpl?: Function,
 *   timeout?: number,
 * }} options
 */
async function checkForUpdate(options = {}) {
  const { currentVersion = '0.0.0', slug = null, fetchImpl = globalThis.fetch, timeout = DEFAULT_TIMEOUT } = options;

  if (!slug) {
    return { ok: false, reason: 'unconfigured', message: '还没有配置仓库地址（package.json 的 repository）' };
  }
  if (typeof fetchImpl !== 'function') {
    return { ok: false, reason: 'no-fetch', message: '当前运行环境不支持发起网络请求' };
  }

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
  if (timer && timer.unref) timer.unref();

  try {
    const response = await fetchImpl(`https://api.github.com/repos/${slug.owner}/${slug.repo}/releases/latest`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'mimo-balance-widget',
      },
      signal: controller ? controller.signal : undefined,
    });
    if (!response || !response.ok) {
      const status = response ? response.status : 0;
      return { ok: false, reason: `http-${status}`, message: `GitHub 返回 ${status || '未知状态'}` };
    }
    const data = await response.json();
    const tag = String((data && (data.tag_name || data.name)) || '').trim();
    if (!parseVersion(tag)) {
      return { ok: false, reason: 'no-tag', message: '发布页没有可识别的版本号' };
    }
    const latestVersion = tag.replace(/^v/i, '');
    return {
      ok: true,
      currentVersion,
      latestVersion,
      hasUpdate: compareVersions(tag, currentVersion) > 0,
      url: (data && data.html_url) || releasesUrl(slug),
    };
  } catch (error) {
    const message = (error && error.name === 'AbortError') ? '请求超时' : (error && error.message) || String(error);
    return { ok: false, reason: 'network', message };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = { checkForUpdate, parseRepoSlug, parseVersion, compareVersions, releasesUrl, DEFAULT_TIMEOUT };
