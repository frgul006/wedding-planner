import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson, contentHash } from '../../src/index.ts';
import { setup, trial } from '../fixtures/evaluator.ts';

test('file store refuses overwrite/path traversal and detects modified records', async () => {
  const context = await setup();
  try {
    await assert.rejects(context.store.saveTrial(trial()), /EEXIST/);
    await assert.rejects(context.store.loadTrial('../outside'), /Invalid saved record/);
    const file = path.join(context.folder, 'trials/trial-example.json');
    const original = JSON.parse(await readFile(file, 'utf8'));
    original.value.status = 'modified';
    await writeFile(file, JSON.stringify(original));
    await assert.rejects(context.store.loadTrial('trial-example'), /integrity/);
  } finally {
    await context.dispose();
  }
});

test('canonical identity ignores object insertion order but rejects lossy evidence', async () => {
  assert.equal(await contentHash({ a: 1, b: 2 }), await contentHash({ b: 2, a: 1 }));
  assert.notEqual(await contentHash({ data: 'one' }), await contentHash({ data: 'two' }));
  assert.throws(() => canonicalJson({ count: NaN }), /JSON values/);
  assert.throws(() => canonicalJson(new Date()), /plain JSON/);
});
