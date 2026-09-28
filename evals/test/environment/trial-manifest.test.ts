import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loginRetry } from '../../tasks/login-retry.ts';
import { createTrialManifest } from '../../environment/trial-manifest.ts';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');

test('manifest hashes the installed package and authored consumer inputs, excluding saved runs and private settings', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'eval-manifest-'));
  try {
    for (const folder of ['environment', 'tasks', 'views']) {
      await mkdir(join(repo, 'evals', folder), { recursive: true });
      await writeFile(join(repo, 'evals', folder, 'index.ts'), 'export {};\n');
    }
    await writeFile(join(repo, 'evals/config.ts'), 'export default {};\n');
    await writeFile(join(repo, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
    const settings = {
      retry: { enabled: true },
      headers: { authorization: 'private-example' },
    };
    const manifest = await createTrialManifest(repo, loginRetry, settings);
    assert.match(manifest.packageHash, /^[a-f0-9]{64}$/);
    assert.equal(manifest.taskHash, hash(JSON.stringify(loginRetry)));
    assert.equal(manifest.dependencyLockHash, hash('lockfileVersion: 9\n'));
    assert.equal(manifest.environmentHash, hash(`index.ts:${hash('export {};\n')}`));
    assert.equal(manifest.viewsHash, manifest.environmentHash);
    assert.equal(manifest.tasksHash, manifest.environmentHash);
    assert.equal(manifest.configHash, hash('export default {};\n'));
    assert.deepEqual(manifest.settings.retry, { enabled: true });
    assert.deepEqual(manifest.settings.extensions, []);
    assert.deepEqual(manifest.settings.packages, []);
    assert.equal(manifest.settings.defaultProjectTrust, 'always');
    assert.equal('headers' in manifest.settings, false);
    await mkdir(join(repo, 'evals/runs'), { recursive: true });
    await writeFile(join(repo, 'evals/runs/ignored.json'), '{"testFixture":true}');
    assert.deepEqual(await createTrialManifest(repo, loginRetry, settings), manifest);
    await writeFile(join(repo, 'evals/environment/index.ts'), 'export const changed = true;\n');
    assert.notEqual(
      (await createTrialManifest(repo, loginRetry, settings)).environmentHash,
      manifest.environmentHash,
    );
    await symlink('index.ts', join(repo, 'evals/environment/link.ts'));
    await assert.rejects(createTrialManifest(repo, loginRetry, settings), /Unexpected symlink/);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
