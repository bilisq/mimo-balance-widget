/** DOM 小工具：只做增删改查，不掺业务。 */

export const $ = (selector, root = document) => root.querySelector(selector);

export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/**
 * 创建元素。
 * @param {string} tag
 * @param {Record<string, any>} [attrs] text / class / dataset / 普通属性
 * @param {Array<Node|string>|Node|string} [children]
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'text') node.textContent = String(value);
    else if (key === 'class') node.className = String(value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function setText(node, text) {
  if (!node) return;
  const next = text === null || text === undefined ? '' : String(text);
  if (node.textContent !== next) node.textContent = next;
}

export function setHidden(node, hidden) {
  if (node) node.hidden = !!hidden;
}

/** 清空子节点。用 textContent 而不是 innerHTML（项目约定：禁用 innerHTML）。 */
export function clear(node) {
  if (node) node.textContent = '';
}

export function on(node, type, handler, options) {
  if (node) node.addEventListener(type, handler, options);
}
