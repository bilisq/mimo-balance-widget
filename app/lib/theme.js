'use strict';

/**
 * 主题解析：设置 > MiMo 偏好 > 系统。
 *
 * MiMo 桌面端把主题写在 %APPDATA%\Xiaomi MiMo\preferences.json 的 theme 字段，
 * 读不到就退回 Electron 的 nativeTheme。
 */

const fs = require('node:fs');

const MIMO_PREFS = ['Xiaomi MiMo', 'preferences.json'];

function readMimoTheme(prefsFile) {
  try {
    const data = JSON.parse(fs.readFileSync(prefsFile, 'utf8'));
    const mode = String(data.theme || '').toLowerCase();
    if (mode === 'dark' || mode === 'light' || mode === 'system') return mode;
  } catch {
    /* 没装 MiMo 或文件不可读：正常情况 */
  }
  return null;
}

/**
 * @param {{settingsTheme?: string, mimoTheme?: string|null, shouldUseDarkColors?: boolean}} input
 * @returns {{dark: boolean, mode: 'light'|'dark'|'auto', source: 'settings'|'mimo'|'system'}}
 */
function resolveTheme(input = {}) {
  const settingsTheme = input.settingsTheme === 'light' || input.settingsTheme === 'dark' ? input.settingsTheme : 'auto';
  if (settingsTheme !== 'auto') {
    return { dark: settingsTheme === 'dark', mode: settingsTheme, source: 'settings' };
  }

  const mimoTheme = input.mimoTheme;
  if (mimoTheme === 'dark') return { dark: true, mode: 'dark', source: 'mimo' };
  if (mimoTheme === 'light') return { dark: false, mode: 'light', source: 'mimo' };

  return { dark: !!input.shouldUseDarkColors, mode: 'auto', source: 'system' };
}

module.exports = { MIMO_PREFS, readMimoTheme, resolveTheme };
