import assert from 'node:assert/strict';
import test from 'node:test';
import { JsonlDecoder, modelMetadata } from '../src/adapters/pi/pi-rpc-process.ts';

test('strict LF framing preserves Unicode separators, CRLF, and split UTF-8', () => {
  const received: Record<string, unknown>[] = [];
  const decoder = new JsonlDecoder((value) => received.push(value));
  const bytes = Buffer.from(
    `${JSON.stringify({ text: 'café\u2028same record\u2029still same' })}\r\n`,
  );
  for (const byte of bytes) {
    decoder.push(Buffer.from([byte]));
  }
  decoder.finish();
  assert.deepEqual(received, [{ text: 'café\u2028same record\u2029still same' }]);
});

test('malformed, oversized, and unfinished JSONL records fail visibly', () => {
  assert.throws(() => new JsonlDecoder(() => {}).push(Buffer.from('not-json\n')), SyntaxError);
  assert.throws(() => new JsonlDecoder(() => {}, 5).push(Buffer.from('{"x":123}\n')), /size limit/);
  const decoder = new JsonlDecoder(() => {});
  decoder.push(Buffer.from('{"x":'));
  assert.throws(() => decoder.finish(), /incomplete JSONL/);
});

test('model metadata excludes provider credentials and request headers', () => {
  assert.deepEqual(
    modelMetadata({
      id: 'test',
      provider: 'openai-codex',
      headers: { Authorization: 'secret' },
      apiKey: 'secret',
      cost: { input: 1 },
    }),
    { id: 'test', provider: 'openai-codex', cost: { input: 1 } },
  );
});
