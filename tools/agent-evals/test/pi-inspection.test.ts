import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import {
  assertSupportedProjectRuntimeSettings,
  inspectPiAuthentication,
} from '../src/adapters/pi-inspection.ts';

test('trusted project runtime overrides cannot silently be replaced by global Pi settings', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-project-settings-test-'));
  try {
    await assertSupportedProjectRuntimeSettings(directory, true);
    await mkdir(join(directory, '.pi'));
    for (const key of [
      'defaultProvider',
      'defaultModel',
      'defaultThinkingLevel',
      'defaultTools',
      'modelThinkingLevels',
      'thinkingBudgets',
      'compaction',
      'retry',
      'steeringMode',
      'followUpMode',
      'transport',
    ]) {
      await writeFile(
        join(directory, '.pi/settings.json'),
        JSON.stringify({ [key]: 'private-setting-value' }),
      );
      await assert.rejects(
        assertSupportedProjectRuntimeSettings(directory, true),
        (error: Error) => {
          assert.match(error.message, /project runtime overrides are not supported/);
          assert.ok(error.message.includes(key));
          assert.equal(error.message.includes('private-setting-value'), false);
          return true;
        },
      );
      await assertSupportedProjectRuntimeSettings(directory, false);
    }
    await writeFile(join(directory, '.pi/settings.json'), JSON.stringify({ theme: 'dark' }));
    await assertSupportedProjectRuntimeSettings(directory, true);
    await writeFile(join(directory, '.pi/settings.json'), '{"private-setting-value":');
    await assert.rejects(
      assertSupportedProjectRuntimeSettings(directory, true),
      /not a valid settings object/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

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
