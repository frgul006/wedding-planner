import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  copyPreparedAuthentication,
  verifyPrivatePiAuthentication,
} from '../src/adapters/isolation/native-auth.ts';

const provider = 'openai-codex';
const now = 1_800_000_000_000;
const runtimeMs = 300_000;
const credential = {
  type: 'oauth',
  access: 'synthetic-access',
  refresh: 'synthetic-refresh',
  expires: now + 3_600_000,
};

async function fixture(run: (destination: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'eval-native-auth-'));
  try {
    await run(join(root, 'private-auth.json'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('native refresh persists in its original store and only the selected provider is copied', async () => {
  await fixture(async (destination) => {
    const original = join(destination, '..', 'original-auth.json');
    await writeFile(
      original,
      JSON.stringify({
        [provider]: { ...credential, expires: now },
        unrelated: { type: 'api_key', key: 'synthetic-unrelated' },
      }),
    );
    const result = await copyPreparedAuthentication(
      { provider, destination, runtimeMs, now: () => now },
      {
        async read(selected) {
          return JSON.parse(await readFile(original, 'utf8'))[selected];
        },
        async ensureValidity(selected, minimumValidityMs) {
          assert.equal(selected, provider);
          assert.equal(minimumValidityMs, runtimeMs + 300_000 + 120_000);
          const current = JSON.parse(await readFile(original, 'utf8'));
          current[selected] = {
            ...credential,
            access: 'synthetic-rotated-access',
            refresh: 'synthetic-rotated-refresh',
          };
          await writeFile(original, JSON.stringify(current));
          return { apiKey: current[selected].access };
        },
      },
    );
    assert.equal(
      JSON.parse(await readFile(original, 'utf8'))[provider].refresh,
      'synthetic-rotated-refresh',
    );
    const copy = JSON.parse(await readFile(destination, 'utf8'));
    assert.deepEqual(Object.keys(copy), [provider]);
    assert.equal(copy[provider].refresh, 'synthetic-rotated-refresh');
    assert.equal((await stat(destination)).mode & 0o777, 0o600);
    assert.equal(result.refreshed, true);
    assert.equal(result.strategy, 'native-locked-refresh-before-private-copy');
    assert.ok(!JSON.stringify(result).includes('synthetic-'));
    await rm(destination);
    assert.equal(
      JSON.parse(await readFile(original, 'utf8'))[provider].refresh,
      'synthetic-rotated-refresh',
    );
  });
});

test('valid native OAuth credentials are reused with explicit full-run validity', async () => {
  await fixture(async (destination) => {
    const result = await copyPreparedAuthentication(
      { provider, destination, runtimeMs, now: () => now },
      {
        async read() {
          return credential;
        },
        async ensureValidity() {
          return { apiKey: credential.access };
        },
      },
    );
    assert.equal(result.refreshed, false);
    assert.equal(result.expiresAt, new Date(credential.expires).toISOString());
    await verifyPrivatePiAuthentication({ provider, destination, runtimeMs, now });
  });
});

test('a failed native refresh cannot persist credentials or expose its error body', async () => {
  await fixture(async (destination) => {
    await assert.rejects(
      copyPreparedAuthentication(
        { provider, destination, runtimeMs, now: () => now },
        {
          async read() {
            return credential;
          },
          async ensureValidity() {
            throw new Error('Provider response contained synthetic-sensitive-value');
          },
        },
      ),
      (error) =>
        error instanceof Error &&
        /Native Pi could not prepare/.test(error.message) &&
        !error.message.includes('synthetic-sensitive-value'),
    );
    await assert.rejects(access(destination));
  });
});

test('a refresh that leaves too little validity fails before writing the trial copy', async () => {
  await fixture(async (destination) => {
    await assert.rejects(
      copyPreparedAuthentication(
        { provider, destination, runtimeMs, now: () => now },
        {
          async read() {
            return { ...credential, expires: now + runtimeMs };
          },
          async ensureValidity() {
            return true;
          },
        },
      ),
      /entire bounded trial/,
    );
    await assert.rejects(access(destination));
  });
});

test('setup consuming reserved validity is caught before agent dispatch', async () => {
  await fixture(async (destination) => {
    await writeFile(destination, JSON.stringify({ [provider]: credential }));
    await assert.rejects(
      verifyPrivatePiAuthentication({
        provider,
        destination,
        runtimeMs,
        now: credential.expires - runtimeMs - 300_000,
      }),
      /entire bounded trial/,
    );
  });
});

test('API authentication copies the selected stored key without attempting OAuth refresh', async () => {
  await fixture(async (destination) => {
    const result = await copyPreparedAuthentication(
      { provider: 'openai', destination, runtimeMs, now: () => now },
      {
        async read() {
          return { type: 'api_key', key: 'synthetic-api-key' };
        },
        async ensureValidity() {
          assert.fail('API keys must not use OAuth refresh');
        },
      },
    );
    assert.equal(result.type, 'api_key');
    assert.equal(result.expiresAt, undefined);
    await verifyPrivatePiAuthentication({ provider: 'openai', destination, runtimeMs, now });
  });
});

test('missing native credentials fail closed without a runtime environment fallback', async () => {
  await fixture(async (destination) => {
    await assert.rejects(
      copyPreparedAuthentication(
        { provider, destination, runtimeMs },
        {
          async read() {
            return undefined;
          },
          async ensureValidity() {
            assert.fail('No fallback');
          },
        },
      ),
      /no supported stored authentication/,
    );
    await assert.rejects(access(destination));
  });
});

test('credential parse errors cannot expose raw authentication snippets', async () => {
  await fixture(async (destination) => {
    await assert.rejects(
      copyPreparedAuthentication(
        { provider, destination, runtimeMs },
        {
          async read() {
            throw new Error('Unexpected token in synthetic-sensitive-value');
          },
          async ensureValidity() {
            assert.fail('No dispatch');
          },
        },
      ),
      (error) =>
        error instanceof Error &&
        /could not read/.test(error.message) &&
        !error.message.includes('synthetic-sensitive-value'),
    );
    await writeFile(destination, '{"synthetic-sensitive-value');
    await assert.rejects(
      verifyPrivatePiAuthentication({ provider, destination, runtimeMs }),
      (error) =>
        error instanceof Error &&
        /could not be verified/.test(error.message) &&
        !error.message.includes('synthetic-sensitive-value'),
    );
  });
});
