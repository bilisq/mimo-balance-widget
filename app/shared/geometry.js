/**
 * 几何常量：主进程与渲染层共享的唯一来源。
 *
 * ES Module：渲染层直接 `import`，主进程用动态 `import()` 读取。
 * 不要把这些数字再抄进 CSS 或 JS 里——历史版本就是因为 CSS 写 170×180、
 * JS 写 180/190 而出现"吸附位置差几像素"的问题。
 */

export const PET = Object.freeze({ width: 170, height: 180 });

export const WINDOW = Object.freeze({
  width: 430,
  height: 430,
  // 0：贴工作区边缘。workArea 已扣掉任务栏，不会盖住任务栏。
  margin: 0,
});

/** 宠物在窗口内的边距（宠物固定在窗口右下角）。 */
export function petInsets() {
  return {
    left: WINDOW.width - PET.width,
    top: WINDOW.height - PET.height,
    right: 0,
    bottom: 0,
  };
}

/** 把窗口坐标换算成宠物在屏幕上的矩形。 */
export function petRect(bounds, scale = 1) {
  const inset = petInsets();
  const width = Math.round(PET.width * scale);
  const height = Math.round(PET.height * scale);
  return {
    x: Math.round(bounds.x + (WINDOW.width - width)),
    y: Math.round(bounds.y + (WINDOW.height - height)),
    width,
    height,
    left: bounds.x + WINDOW.width - width,
    top: bounds.y + WINDOW.height - height,
  };
}
