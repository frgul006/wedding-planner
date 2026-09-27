import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { profileSchema, taskSchema } from '../src/adapters/evaluation-config.ts';
import { createTrialManifest } from '../src/adapters/trial-manifest.ts';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');

test('manifest retains reproducibility hashes and isolated public settings without native resource dependencies', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'eval-manifest-'));
  try {
    const sources = join(repo, 'tools/agent-evals/src');
    await mkdir(sources, { recursive: true });
    await writeFile(join(sources, 'index.ts'), 'export {};\n');
    await writeFile(join(repo, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
    const task = taskSchema.parse({
      id: 'retry',
      version: '1',
      repository: { revision: 'a'.repeat(40) },
      acceptance: 'admin-login-retry',
      prompt: 'Investigate login retry.',
      targetFile: 'login.tsx',
      expectedText: 'Try again.',
      flowPath: '/admin/login',
    });
    const profile = profileSchema.parse({
      id: 'smoke',
      agentBilling: 'subscription',
      maxAgentEstimatedCostUsd: null,
    });
    const settings = { retry: { enabled: true }, headers: { authorization: 'private-example' } };
    const manifest = await createTrialManifest(repo, task, profile, settings);
    assert.equal(manifest.revision, task.repository.revision);
    assert.equal(manifest.taskHash, hash(JSON.stringify(task)));
    assert.equal(manifest.profileHash, hash(JSON.stringify(profile)));
    assert.equal(manifest.dependencyLockHash, hash('lockfileVersion: 9\n'));
    assert.equal(manifest.harnessHash, hash(`index.ts:${hash('export {};\n')}`));
    assert.deepEqual(manifest.settings.retry, { enabled: true });
    assert.deepEqual(manifest.settings.extensions, []);
    assert.deepEqual(manifest.settings.packages, []);
    assert.equal(manifest.settings.defaultProjectTrust, 'always');
    assert.equal('headers' in manifest.settings, false);
    await writeFile(join(sources, 'index.ts'), 'export const changed = true;\n');
    assert.notEqual(
      (await createTrialManifest(repo, task, profile, settings)).harnessHash,
      manifest.harnessHash,
    );
    await symlink('index.ts', join(sources, 'link.ts'));
    await assert.rejects(createTrialManifest(repo, task, profile, settings), /Unexpected symlink/);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
