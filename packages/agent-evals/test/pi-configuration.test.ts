import assert from 'node:assert/strict';
import test from 'node:test';
import { isolatedPiSettings } from '../src/adapters/pi/pi-configuration.ts';

test('isolated native settings preserve conversation policy and omit unsafe configuration', () => {
  const saved = {
    defaultProvider: 'selected-provider',
    defaultModel: 'selected-model',
    defaultThinkingLevel: 'high',
    compaction: { enabled: true, reserveTokens: 12000 },
    retry: { enabled: true, maxRetries: 2 },
    transport: 'sse',
    packages: ['arbitrary-code'],
    extensions: ['arbitrary-tools'],
    headers: { authorization: 'synthetic-private-header' },
  };
  const original = structuredClone(saved);
  const native = isolatedPiSettings(saved);
  for (const key of [
    'defaultProvider',
    'defaultModel',
    'defaultThinkingLevel',
    'compaction',
    'retry',
    'transport',
  ] as const)
    assert.deepEqual(native[key], saved[key]);
  assert.deepEqual(native.packages, []);
  assert.deepEqual(native.extensions, []);
  assert.equal(native.defaultProjectTrust, 'always');
  assert.equal(native.enableInstallTelemetry, false);
  assert.equal(native.enableAnalytics, false);
  assert.equal('headers' in native, false);
  assert.deepEqual(saved, original);
});
