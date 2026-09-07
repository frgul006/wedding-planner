import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { inspectPiAuthentication } from '../src/adapters/pi-inspection.ts';

test('authentication provenance exposes only the active provider and known auth type', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-auth-inspection-test-'));
  try {
    await writeFile(
      join(directory, 'auth.json'),
      JSON.stringify({
        'openai-codex': {
          type: 'oauth',
          access: 'fixture-access-token',
          refresh: 'fixture-refresh-token',
          accountId: 'private-account',
        },
        openai: { type: 'api_key', key: 'fixture-api-key' },
      }),
    );
    assert.deepEqual(await inspectPiAuthentication(directory, 'openai-codex'), {
      provider: 'openai-codex',
      type: 'oauth',
    });
    assert.deepEqual(await inspectPiAuthentication(directory, 'openai'), {
      provider: 'openai',
      type: 'api_key',
    });
    assert.deepEqual(await inspectPiAuthentication(directory, 'missing'), {
      provider: 'missing',
      type: 'unknown',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('unrecognized or malformed authentication never leaks fields or error excerpts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-auth-inspection-test-'));
  try {
    await writeFile(
      join(directory, 'auth.json'),
      JSON.stringify({ 'openai-codex': { type: 'fixture-secret-in-wrong-field' } }),
    );
    assert.deepEqual(await inspectPiAuthentication(directory, 'openai-codex'), {
      provider: 'openai-codex',
      type: 'unknown',
    });
    await writeFile(join(directory, 'auth.json'), '{"key":"fixture-sensitive-json-error-excerpt"');
    assert.deepEqual(await inspectPiAuthentication(directory, 'openai-codex'), {
      provider: 'openai-codex',
      type: 'unknown',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
