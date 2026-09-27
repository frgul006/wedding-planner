import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, safeError } from '../src/adapters/secrets.ts';

test('known keys, bearer credentials and JWTs are removed from persisted text', () => {
  const text = redact('Bearer opaque-token sk-abcdefghijklmno eyJabcd.abcdef.abcdef');
  for (const forbidden of ['opaque-token', 'sk-abcdefghijklmno', 'eyJabcd'])
    assert.ok(!text.includes(forbidden));
});
test('safe errors redact message credentials without serializing request objects or causes', () => {
  const error = new Error('Request failed: Bearer offline-token', {
    cause: { apiKey: 'private-cause-value' },
  });
  assert.equal(safeError(error), 'Request failed: Bearer [REDACTED]');
  assert.equal(safeError({ request: { apiKey: 'private-object-value' } }), 'Unknown error');
});
