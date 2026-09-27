import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  checkPiEndpointReadiness,
  endpointHash,
  projectPiModelsConfiguration,
  selectPiEndpoint,
} from '../src/adapters/pi-endpoint-selection.ts';

const provider = 'openai-codex';
const model = 'gpt-6-luna';
const catalog = 'https://chatgpt.com/backend-api';
const native = 'http://127.0.0.1:8787/v1';
const configured = JSON.stringify({
  providers: {
    [provider]: { baseUrl: native },
    untouched: {
      baseUrl: 'https://elsewhere.invalid/api',
      headers: { 'X-Example': 'synthetic-test-header' },
    },
  },
});

test('explicit catalog projection removes only selected endpoint-only override and never mutates native text', () => {
  assert.equal(projectPiModelsConfiguration(configured, provider, 'native'), configured);
  const projected = JSON.parse(projectPiModelsConfiguration(configured, provider, 'catalog'));
  assert.equal(projected.providers[provider], undefined);
  assert.deepEqual(projected.providers.untouched, JSON.parse(configured).providers.untouched);
  assert.equal(JSON.parse(configured).providers[provider].baseUrl, native);
});

test('catalog projection refuses to transplant proxy credentials or custom model definitions', () => {
  for (const field of ['headers', 'apiKey', 'models']) {
    const source = JSON.stringify({
      providers: { [provider]: { baseUrl: native, [field]: 'synthetic-private-setting' } },
    });
    assert.throws(
      () => projectPiModelsConfiguration(source, provider, 'catalog'),
      /endpoint-only provider override/,
    );
    assert.equal(projectPiModelsConfiguration(source, provider, 'native'), source);
  }
});

test('endpoint selection records saved versus effective identities and preserves source files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-endpoint-test-'));
  try {
    await writeFile(join(directory, 'models.json'), configured);
    await writeFile(
      join(directory, 'models-store.json'),
      JSON.stringify({ [provider]: { models: [{ id: model, baseUrl: catalog }] } }),
    );
    const selection = await selectPiEndpoint({
      agentDir: directory,
      provider,
      model,
      policy: 'catalog',
    });
    assert.deepEqual(selection.savedOverride, {
      origin: 'http://127.0.0.1:8787',
      sha256: endpointHash(native),
    });
    assert.deepEqual(selection.effective, {
      origin: 'https://chatgpt.com',
      sha256: endpointHash(catalog),
    });
    assert.equal(
      (await selectPiEndpoint({ agentDir: directory, provider, model })).effective.sha256,
      endpointHash(native),
    );
    assert.equal(await readFile(join(directory, 'models.json'), 'utf8'), configured);
    await assert.rejects(
      selectPiEndpoint({ agentDir: directory, provider, model: 'absent', policy: 'catalog' }),
      /catalog/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('endpoint diagnostic metadata excludes URL credentials, path and query', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-endpoint-private-test-'));
  try {
    await writeFile(
      join(directory, 'models.json'),
      JSON.stringify({
        providers: {
          [provider]: {
            baseUrl:
              'http://user:synthetic-secret@127.0.0.1:8787/private/path?token=synthetic-secret',
          },
        },
      }),
    );
    await writeFile(
      join(directory, 'models-store.json'),
      JSON.stringify({ [provider]: { models: [{ id: model, baseUrl: catalog }] } }),
    );
    const serialized = JSON.stringify(
      await selectPiEndpoint({ agentDir: directory, provider, model }),
    );
    assert.doesNotMatch(serialized, /user|synthetic-secret|private|token/);
    assert.match(serialized, /127\.0\.0\.1:8787/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('an explicit native endpoint works without a catalog cache, while catalog mode requires it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-endpoint-no-cache-test-'));
  try {
    await writeFile(join(directory, 'models.json'), configured);
    const selected = await selectPiEndpoint({ agentDir: directory, provider, model });
    assert.equal(selected.policy, 'native');
    assert.deepEqual(selected.effective, {
      origin: 'http://127.0.0.1:8787',
      sha256: endpointHash(native),
    });
    assert.deepEqual(selected.savedOverride, selected.effective);
    await assert.rejects(
      selectPiEndpoint({ agentDir: directory, provider, model, policy: 'catalog' }),
      /native model catalog/,
    );
    await writeFile(join(directory, 'models-store.json'), 'invalid stale cache');
    assert.deepEqual(
      (await selectPiEndpoint({ agentDir: directory, provider, model })).effective,
      selected.effective,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the stale local static-server endpoint is diagnosed with HEAD only and no credentials', async () => {
  const requests: Array<{ method?: string; authorization?: string }> = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method, authorization: request.headers.authorization });
    response.setHeader('server', 'SimpleHTTP/0.6 Python/3.11.6');
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    await assert.rejects(
      checkPiEndpointReadiness({
        policy: 'native',
        provider,
        model,
        savedOverride: null,
        effective: { origin: `http://127.0.0.1:${address.port}`, sha256: endpointHash(native) },
      }),
      /static HTTP file server.*pi.endpoint="catalog"/,
    );
    assert.deepEqual(requests, [{ method: 'HEAD', authorization: undefined }]);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
