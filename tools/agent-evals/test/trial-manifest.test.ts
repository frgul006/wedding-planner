import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { hashText, profileSchema, taskSchema } from '../src/adapters/evaluation-config.ts';
import { trialInvariants } from '../src/adapters/trial-manifest.ts';

const git = (cwd: string, args: string[]) =>
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

test('manifest records selected native resources without requiring pilot AGENTS or project skills', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'eval-manifest-'));
  try {
    await mkdir(join(repo, 'tools/agent-evals/src'), { recursive: true });
    await writeFile(join(repo, 'tools/agent-evals/src/index.ts'), 'export {};\n');
    await writeFile(join(repo, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
    await writeFile(join(repo, 'CLAUDE.md'), 'Keep the selected native instructions.\n');
    git(repo, ['init', '-q']);
    git(repo, ['add', '-A']);
    git(repo, [
      '-c',
      'user.name=Offline Test',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-qm',
      'Pinned manifest input',
    ]);
    const revision = git(repo, ['rev-parse', 'HEAD']);
    const task = taskSchema.parse({
      id: 'retry',
      version: '1',
      environment: 'repository',
      repository: { revision },
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
    const selected = {
      path: join(repo, 'CLAUDE.md'),
      sha256: hashText('Keep the selected native instructions.\n'),
      scope: 'project',
    };
    await assert.rejects(access(join(repo, 'AGENTS.md')), { code: 'ENOENT' });
    await assert.rejects(access(join(repo, '.agents/skills')), { code: 'ENOENT' });
    for (const instructions of [[selected], []]) {
      // Only the inspected, credential-free fields used by manifest construction are needed.
      const pi = {
        version: 'fixture-pi',
        agentDir: join(repo, 'native-user'),
        defaults: { provider: 'fixture', model: 'saved', thinkingLevel: 'high' },
        conversationSettings: { retry: { enabled: true } },
        resources: {
          cwd: repo,
          projectTrusted: true,
          instructions,
          skills: [],
          systemPrompts: [],
          extensions: [],
          prompts: [],
        },
      } as unknown as Parameters<typeof trialInvariants>[3];
      const model = { provider: 'fixture', model: 'evaluation', thinkingLevel: 'high' };
      const { invariants } = await trialInvariants(repo, task, profile, pi, model);
      assert.equal(invariants.revision, revision);
      assert.equal(invariants.taskHash, hashText(JSON.stringify(task)));
      assert.equal(invariants.profileHash, hashText(JSON.stringify(profile)));
      assert.equal(invariants.dependencyLockHash, hashText('lockfileVersion: 9\n'));
      assert.match(invariants.harnessHash, /^[a-f0-9]{64}$/);
      assert.deepEqual(invariants.model, model);
      assert.deepEqual(
        invariants.sourceHashes,
        instructions.map(({ sha256 }) => ({ source: 'project/CLAUDE.md', sha256 })),
      );
      assert.equal('repositorySkillsHash' in invariants, false);
      assert.equal('instructionTemplateHash' in invariants, false);
    }
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
