/**
 * 透明区点击穿透：空白处不挡下方窗口，宠物/面板/菜单可交互。
 *
 * 主进程默认 setIgnoreMouseEvents(true, { forward: true })：
 * 点击穿透到下层窗口，但 mousemove 仍转发给本页。
 *
 * 不能依赖 elementFromPoint + pointer-events：穿透开启时点击进不了页面，
 * 且透明/transform 区域的命中不稳定。改用 getBoundingClientRect 几何判定，
 * 宠物再留一圈热区；按住期间锁死捕获，避免拖出边界后丢事件。
 */

const TARGETS = [
  { selector: '#whale', pad: 16 },
  { selector: '#panel', pad: 0 },
  { selector: '#menu', pad: 0 },
  { selector: '#diagnostics', pad: 0 },
];

function rectHits(x, y, rect, pad) {
  return x >= rect.left - pad && x <= rect.right + pad && y >= rect.top - pad && y <= rect.bottom + pad;
}

export function setupClickThrough({ api }) {
  let capturing = false;
  let pointerDown = false;
  let hold = false;
  let warned = false;

  function setCapture(on) {
    if (on === capturing) return;
    capturing = on;
    // 供自动化检查（smoke）读：'1' = 已捕获鼠标，'0' = 穿透中
    try { document.body.dataset.mouseCapture = on ? '1' : '0'; } catch { /* 忽略 */ }
    try {
      api.window.setMouseIgnore(!on);
    } catch (error) {
      // 绝不能静默：这里一旦失败，表现就是"宠物点不动"，
      // 而外层看起来一切正常（正好踩过一次）。
      if (!warned) {
        warned = true;
        console.error('clickthrough: setMouseIgnore 调用失败', error && error.message);
      }
    }
  }

  function shouldCapture(x, y) {
    for (const { selector, pad } of TARGETS) {
      const el = document.querySelector(selector);
      if (!el || el.hidden) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (rectHits(x, y, rect, pad)) return true;
    }
    return false;
  }

  window.addEventListener('mousemove', (event) => {
    if (pointerDown || hold) return; // 拖拽中 / 气泡可见时锁死捕获
    setCapture(shouldCapture(event.clientX, event.clientY));
  });

  window.addEventListener('pointerdown', (event) => {
    // 穿透时点击进不了页面；已捕获时按住拖出边界也要继续跟手
    pointerDown = true;
    if (hold || shouldCapture(event.clientX, event.clientY) || capturing) setCapture(true);
  }, true);

  window.addEventListener('pointerup', (event) => {
    pointerDown = false;
    if (hold) { setCapture(true); return; }
    setCapture(shouldCapture(event.clientX, event.clientY));
  });

  window.addEventListener('blur', () => {
    pointerDown = false;
    hold = false;
    setCapture(false);
  });

  /**
   * 强制捕获一段时间（气泡可见时用）：
   * 不这样做的活，气泡显示在空白区时窗口仍是穿透的，点击根本到不了页面，
   * 也就没法实现"点任意空白处关闭"。
   */
  function setHold(on) {
    hold = !!on;
    setCapture(hold ? true : false);
  }

  return { setCapture, setHold };
}
