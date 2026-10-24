/** 主题 / 皮肤 / 缩放：只改 DOM 属性与 CSS 变量，不碰业务状态。 */

export function applyTheme(theme, settings) {
  const dark = !!(theme && theme.dark);
  document.body.dataset.theme = dark ? 'dark' : 'light';
  applyToastColors(settings, dark);
  return dark;
}

export function applyPreset(presetId) {
  document.body.dataset.preset = presetId || 'xiaomi';
}

export function applyScale(scale) {
  const value = Math.min(1.6, Math.max(0.6, Number(scale) || 1));
  document.body.style.setProperty('--pet-scale', String(value));
}

/**
 * 气泡配色：跟随主题时移除内联变量，让 tokens.css 的主题值生效。
 * 注意要设在 body 上——深色主题的变量也声明在 body 上。
 */
export function applyToastColors(settings, dark) {
  const body = document.body;
  const custom = settings && settings.toastMode === 'custom' && settings.toastColors;
  if (!custom) {
    body.style.removeProperty('--toast-text');
    body.style.removeProperty('--toast-fill');
    body.style.removeProperty('--toast-stroke');
    return;
  }
  // 深色模式沿用主题的底色，只让用户改文字与轮廓，避免"白底白字"
  body.style.setProperty('--toast-text', dark ? 'var(--toast-text-dark, #f4f4f5)' : settings.toastColors.text);
  body.style.setProperty('--toast-fill', dark ? 'var(--toast-fill-dark, #141414)' : settings.toastColors.fill);
  body.style.setProperty('--toast-stroke', settings.toastColors.stroke);
}
