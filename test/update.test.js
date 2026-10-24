'use strict';

/** 检查更新的纯逻辑：不联网，用假 fetch 验证。 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { checkForUpdate, compareVersions, parseRepoSlug, parseVersion } = require('../app/lib/update');

test('从 repository 解析 owner/repo', () => {
  assert.deepEqual(parseRepoSlug({ repository: 'https://github.com/alice/mimo-widget.git' }), {
    owner: 'alice',
    repo: 'mimo-widget',
  });
  assert.deepEqual(parseRepoSlug({ repository: { url: 'git+https://github.com/alice/mimo-widget' } }), {
    owner: 'alice',
    repo: 'mimo-widget',
  });
});

test('占位符仓库视为未配置', () => {
  assert.equal(parseRepoSlug({ repository: 'https://github.com/your-name/mimo-balance-widget.git' }), null);
  assert.equal(parseRepoSlug({}), null);
  assert.equal(parseRepoSlug(null), null);
});

test('版本比较只认 major.minor.patch', () => {
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  assert.equal(compareVersions('v1.3.0', '1.2.9'), 1);
  assert.equal(compareVersions('0.2.0', '0.10.0'), -1);
  assert.equal(compareVersions('1.0.0-beta.1', '1.0.0'), 0);
  assert.equal(parseVersion('abc'), null);
});

test('发现新版本', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ tag_name: 'v0.3.0', html_url: 'https://github.com/a/b/releases/tag/v0.3.0' }),
  });
  const result = await checkForUpdate({
    currentVersion: '0.2.0',
    slug: { owner: 'a', repo: 'b' },
    fetchImpl,
  });
  assert.equal(result.ok, true);
  assert.equal(result.latestVersion, '0.3.0');
  assert.equal(result.hasUpdate, true);
  assert.match(result.url, /releases\/tag/);
});

test('已是最新版本', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ tag_name: 'v0.2.0' }) });
  const result = await checkForUpdate({ currentVersion: '0.2.0', slug: { owner: 'a', repo: 'b' }, fetchImpl });
  assert.equal(result.hasUpdate, false);
});

test('未配置仓库时给出可读原因，而不是当成网络错误', async () => {
  const result = await checkForUpdate({ currentVersion: '0.2.0', slug: null });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unconfigured');
});

test('HTTP 错误与网络异常都被包装成结果对象', async () => {
  const notFound = await checkForUpdate({
    currentVersion: '0.2.0',
    slug: { owner: 'a', repo: 'b' },
    fetchImpl: async () => ({ ok: false, status: 404 }),
  });
  assert.equal(notFound.reason, 'http-404');

  const boom = await checkForUpdate({
    currentVersion: '0.2.0',
    slug: { owner: 'a', repo: 'b' },
    fetchImpl: async () => {
      throw new Error('offline');
    },
  });
  assert.equal(boom.reason, 'network');
  assert.match(boom.message, /offline/);
});

test('发布页没有版本号时说明原因', async () => {
  const result = await checkForUpdate({
    currentVersion: '0.2.0',
    slug: { owner: 'a', repo: 'b' },
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ name: 'nightly' }) }),
  });
  assert.equal(result.reason, 'no-tag');
});
