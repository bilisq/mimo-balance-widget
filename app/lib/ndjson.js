'use strict';

/**
 * NDJSON 分帧（纯函数，可单测）。
 *
 * 子进程的 stdout 是字节流，一次 'data' 事件可能给你半行，也可能给你
 * 三行半。这里只负责"攒够一行就交出去"，解析语义留给调用方。
 */

const MAX_BUFFER = 2 * 1024 * 1024;

function createLineReader(onLine) {
  let buffer = '';

  return {
    push(chunk) {
      buffer += chunk;
      let index = buffer.indexOf('\n');
      while (index >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, '');
        buffer = buffer.slice(index + 1);
        if (line.trim()) onLine(line);
        index = buffer.indexOf('\n');
      }
      if (buffer.length > MAX_BUFFER) buffer = '';
    },
    flush() {
      const rest = buffer.trim();
      buffer = '';
      if (rest) onLine(rest);
    },
    get pending() {
      return buffer;
    },
  };
}

function encodeRequest(id, cmd, args) {
  return `${JSON.stringify({ id, cmd, args: args || {} })}\n`;
}

/**
 * 解析一行响应；非法 JSON 返回 null。
 * @returns {{id: number|string|null, ok: boolean, data?: any, error?: {code: string, message: string}, event?: string}|null}
 */
function parseEnvelope(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return null;
  }
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  if (message.event) return { event: String(message.event), id: message.id ?? null, ok: true, data: message };
  return {
    id: message.id ?? null,
    ok: message.ok !== false,
    data: message.data,
    error: message.error,
  };
}

module.exports = { createLineReader, encodeRequest, parseEnvelope };
