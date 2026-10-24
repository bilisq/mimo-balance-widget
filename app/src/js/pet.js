/**
 * 桌宠本体：拖拽移动、松手吸附、单击开面板、贴图与缩放。
 *
 * 拖拽期间只发 `window:move`（一次性定位，不做惯性/节流），松手才吸附，
 * 避免拖动过程中反复 setPosition 造成的抖动。
 */

import { $ } from './dom.js';

const PRESET_IMAGES = {
  xiaomi: { light: '../../artwork-nc/xiaomi.png', dark: '../../artwork-nc/xiaomi.png' },
  xiaoai: { light: '../../artwork-nc/xiaoai.png', dark: '../../artwork-nc/xiaoai-dark.png' },
  whale: { light: '../assets/whale-tight.png', dark: '../assets/whale-tight.png' },
};

export function presetImage(presetId, dark) {
  const entry = PRESET_IMAGES[presetId] || PRESET_IMAGES.xiaomi;
  return dark ? entry.dark : entry.light;
}

export function createPet({ api, audio, onActivate, onContextMenu }) {
  const root = $('#pet');
  const whale = $('#whale');
  const image = $('#pet-image');

  let drag = null;
  let suppressClick = false;

  function setImage(src) {
    if (image && src && image.getAttribute('src') !== src) image.src = src;
  }

  function usePreset(presetId, dark) {
    setImage(presetImage(presetId, dark));
  }

  function useCustom(dataUrl) {
    if (dataUrl) setImage(dataUrl);
  }

  async function onPointerDown(event) {
    if (event.button !== 0) return;
    if (event.target.closest('.menu-button')) return;
    event.preventDefault();
    audio.press();
    whale.classList.add('is-pressed');
    whale.classList.remove('is-released');

    let geometry = { x: 0, y: 0 };
    try {
      geometry = await api.window.geometry();
    } catch {
      /* 拿不到位置就退化为"只有点击" */
    }
    drag = {
      pointerId: event.pointerId,
      startScreenX: event.screenX,
      startScreenY: event.screenY,
      startX: geometry.x,
      startY: geometry.y,
      moved: false,
    };
    try {
      whale.setPointerCapture(event.pointerId);
    } catch {
      /* 某些环境不支持指针捕获 */
    }
  }

  function onPointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.screenX - drag.startScreenX;
    const dy = event.screenY - drag.startScreenY;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 5) {
      drag.moved = true;
      whale.classList.remove('is-pressed');
    }
    if (!drag.moved) return;
    api.window.move({ x: drag.startX + dx, y: drag.startY + dy });
  }

  function finishDrag(event) {
    if (!drag || (event && event.pointerId !== drag.pointerId)) return;
    const moved = drag.moved;
    drag = null;
    try {
      whale.releasePointerCapture(event.pointerId);
    } catch {
      /* 忽略 */
    }
    whale.classList.remove('is-pressed');
    if (moved) {
      whale.classList.add('is-released');
      setTimeout(() => whale.classList.remove('is-released'), 400);
      api.window.snap();
      suppressClick = true;
      setTimeout(() => {
        suppressClick = false;
      }, 120);
    }
    audio.release();
  }

  if (whale) {
    whale.addEventListener('pointerdown', onPointerDown);
    whale.addEventListener('pointermove', onPointerMove);
    whale.addEventListener('pointerup', finishDrag);
    whale.addEventListener('pointercancel', finishDrag);
    whale.addEventListener('click', (event) => {
      if (suppressClick || drag) return;
      if (event.target.closest('.menu-button')) return;
      onActivate();
    });
    whale.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      onContextMenu();
    });
    // 鼠标靠近宠物附近就显示菜单按钮，避免必须精确悬停
    whale.addEventListener('mouseenter', () => root.classList.add('is-zone'));
    whale.addEventListener('mouseleave', () => root.classList.remove('is-zone'));
  }

  return {
    usePreset,
    useCustom,
    setImage,
    element: whale,
  };
}
