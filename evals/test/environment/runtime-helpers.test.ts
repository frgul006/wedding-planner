import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { copyRuntimeHelper } from '../../environment/runtime/runtime-helpers.ts';

test('emitted file worker runs as standalone JavaScript outside the repository', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eval-runtime-helper-'));
  try {
    const control = join(root, 'private-control');
    const unrelatedCwd = join(root, 'unrelated-cwd');
    await Promise.all([mkdir(control), mkdir(unrelatedCwd)]);
    const worker = join(control, 'file-worker.mjs');
    await copyRuntimeHelper('isolation/file-worker', worker);

    const run = (operation: string, path: string, input?: Buffer): Buffer => {
      const result = spawnSync(process.execPath, [worker, operation, path], {
        cwd: unrelatedCwd,
        env: {},
        input,
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr.toString());
      assert.equal(result.stderr.length, 0);
      return result.stdout;
    };

    const directory = join(root, 'workspace', 'nested');
    const file = join(directory, 'sample.bin');
    const content = Buffer.from([0, 10, 127, 255]);
    run('mkdir', directory);
    run('write', file, content);
    run('access', file);
    assert.deepEqual(run('read', file), content);
    assert.deepEqual(await readFile(file), content);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
