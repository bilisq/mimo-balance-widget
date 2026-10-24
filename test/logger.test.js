'use strict';

/**
 * 日志出口的脱敏：编码阶段就该保证不写凭证，但异常堆栈、第三方库消息、
 * 调试输出都可能把整段 Cookie 带进来。与其信任每个调用点，不如在写盘前统一擦。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { redact } = require('../app/lib/logger');

test('擦掉 api-platform_serviceToken 的值，保留 userId', () => {
  const out = redact('auth: api-platform_serviceToken=SECRET123; userId=42');
  assert.ok(!out.includes('SECRET123'), out);
  assert.ok(out.includes('api-platform_serviceToken=***'), out);
  assert.ok(out.includes('userId=42'), 'userId 不是凭证，保留便于排查');
});

test('擦掉带引号的 token', () => {
  const out = redact('api-platform_serviceToken="A/EKIm1WUwZbhPRjZZ"');
  assert.ok(!out.includes('A/EKIm1WUwZbhPRjZZ'), out);
  assert.ok(out.includes('***'), out);
});

test('整行 Cookie: 之后的内容全部擦掉（最保险）', () => {
  const out = redact('request Cookie: api-platform_serviceToken=x; userId=1; api-platform_slh=abc');
  assert.ok(!out.includes('api-platform_slh=abc'), out);
  assert.ok(!out.includes('userId=1'), out);
  assert.ok(out.includes('Cookie: ***'), out);
});

test('普通日志不受影响', () => {
  const line = '2026-10-19T12:00:00Z INFO  sidecar.ready {"state":"ready"}';
  assert.equal(redact(line), line);
});

test('空值与非字符串不炸', () => {
  assert.equal(redact(null), '');
  assert.equal(redact(undefined), '');
  assert.equal(redact(42), '42');
});
