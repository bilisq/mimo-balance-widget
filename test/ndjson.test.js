'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createLineReader, encodeRequest, parseEnvelope } = require('../app/lib/ndjson');

test('分帧：一次数据里有多行', () => {
  const lines = [];
  const reader = createLineReader((line) => lines.push(line));
  reader.push('{"a":1}\n{"b":2}\n');
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
});

test('分帧：半行会等待下一块', () => {
  const lines = [];
  const reader = createLineReader((line) => lines.push(line));
  reader.push('{"a":');
  assert.deepEqual(lines, []);
  reader.push('1}\n');
  assert.deepEqual(lines, ['{"a":1}']);
  assert.equal(reader.pending, '');
});

test('分帧：兼容 CRLF 与空行', () => {
  const lines = [];
  const reader = createLineReader((line) => lines.push(line));
  reader.push('{"a":1}\r\n\r\n{"b":2}\r\n');
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
});

test('分帧：flush 交出没有换行符的尾巴', () => {
  const lines = [];
  const reader = createLineReader((line) => lines.push(line));
  reader.push('{"a":1}');
  reader.flush();
  assert.deepEqual(lines, ['{"a":1}']);
});

test('encodeRequest 生成单行 JSON', () => {
  const line = encodeRequest(7, 'probe', { session: 's1' });
  assert.ok(line.endsWith('\n'));
  assert.equal(line.trim().split('\n').length, 1);
  assert.deepEqual(JSON.parse(line), { id: 7, cmd: 'probe', args: { session: 's1' } });
});

test('parseEnvelope 区分成功 / 失败 / 事件 / 坏 JSON', () => {
  assert.deepEqual(parseEnvelope('{"id":1,"ok":true,"data":{"x":1}}'), { id: 1, ok: true, data: { x: 1 }, error: undefined });
  const failure = parseEnvelope('{"id":2,"ok":false,"error":{"code":"NO_DB","message":"找不到库"}}');
  assert.equal(failure.ok, false);
  assert.equal(failure.error.code, 'NO_DB');
  const ready = parseEnvelope('{"event":"ready","version":"0.1.0","pid":1}');
  assert.equal(ready.event, 'ready');
  assert.equal(ready.data.version, '0.1.0');
  assert.equal(parseEnvelope('not json'), null);
  assert.equal(parseEnvelope('[1,2]'), null);
});
