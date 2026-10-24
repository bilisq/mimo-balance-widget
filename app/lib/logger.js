'use strict';

/**
 * 文件日志：挂件没有控制台，出问题只能看日志。
 * 单个文件超过 1 MB 时滚动为 app.1.log，最多保留一份历史。
 */

const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 1024 * 1024;

function rotateIfNeeded(file) {
  try {
    const stat = fs.statSync(file);
    if (stat.size < MAX_BYTES) return;
    fs.renameSync(file, `${file.replace(/\.log$/, '')}.1.log`);
  } catch {
    /* 文件不存在或正被占用：忽略 */
  }
}

/**
 * 兜底脱敏：任何一行日志落盘前都过一遍。
 *
 * 代码里本来就只写"是否配置"和 userId，但异常堆栈、第三方库报错、调试输出都可能
 * 把完整 Cookie 带进来。与其相信每个调用点，不如在出口统一擦掉。
 *
 * 每条规则自带替换函数：它们的捕获组数量不同，共用一个回调会错位。
 */
const SECRET_RULES = [
  {
    // api-platform_serviceToken=xxx;  或  api-platform_serviceToken="xxx"
    pattern: /(api-platform_serviceToken\s*=\s*)["']?[^;"'\s]+["']?/gi,
    replace: (_match, prefix) => `${prefix}***`,
  },
  {
    // 整行 Cookie: ... 之后一律抹掉（最保险）
    pattern: /(cookie\s*:\s*)[^\r\n]+/gi,
    replace: (_match, prefix) => `${prefix}***`,
  },
];

function redact(text) {
  let out = String(text === null || text === undefined ? '' : text);
  for (const rule of SECRET_RULES) out = out.replace(rule.pattern, rule.replace);
  return out;
}

function createLogger(dir) {
  const file = path.join(dir, 'app.log');
  try {
    fs.mkdirSync(dir, { recursive: true });
    rotateIfNeeded(file);
  } catch {
    /* 日志目录不可写时退化为只输出控制台 */
  }

  let stream = null;
  try {
    stream = fs.createWriteStream(file, { flags: 'a' });
    stream.on('error', () => {
      stream = null;
    });
  } catch {
    stream = null;
  }

  function write(level, scope, detail) {
    const stamp = new Date().toISOString();
    let extra = '';
    if (detail instanceof Error) {
      extra = ` | ${detail.message}`;
      if (detail.stack && process.env.MIMO_WHALE_DEBUG) extra += `\n${detail.stack}`;
    } else if (detail !== undefined) {
      extra = ` | ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
    }
    const line = redact(`${stamp} ${level.padEnd(5)} ${scope}${extra}`);
    if (stream) {
      try {
        stream.write(`${line}\n`);
      } catch {
        /* 忽略写入失败 */
      }
    }
    if (level === 'ERROR' || process.env.MIMO_WHALE_DEBUG) {
      // eslint-disable-next-line no-console
      console.error(line);
    }
  }

  return {
    file,
    debug: (scope, detail) => write('DEBUG', scope, detail),
    info: (scope, detail) => write('INFO', scope, detail),
    warn: (scope, detail) => write('WARN', scope, detail),
    error: (scope, detail) => write('ERROR', scope, detail),
    close: () => {
      if (stream) stream.end();
    },
  };
}

module.exports = { createLogger, redact };
