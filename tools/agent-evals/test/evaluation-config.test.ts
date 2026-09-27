import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  catalogNames,
  loadProfile,
  loadTask,
  profileSchema,
  taskSchema,
} from '../src/adapters/evaluation-config.ts';
import { DEFAULT_TRIAL_LIMITS } from '../src/domain/trial-limits.ts';

const task = {
  id: 'login-case',
  version: '1',
  repository: { revision: 'a'.repeat(40) },
  acceptance: 'admin-login-retry',
  prompt: 'Repair login retry.',
  targetFile: 'app/admin/login/login-form.tsx',
  expectedText: 'Invalid email or password.',
  flowPath: '/admin/login',
};
const profile = {
  id: 'smoke',
  pi: { model: 'gpt-6-luna', endpoint: 'catalog' },
  agentBilling: 'subscription',
  maxAgentEstimatedCostUsd: null,
};
const git = (repo: string, args: string[]) =>
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
function commit(repo: string) {
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
    'Pinned test source',
  ]);
  return git(repo, ['rev-parse', 'HEAD']);
}

async function fixture(run: (repo: string, definition: typeof task) => Promise<void>) {
  const repo = await mkdtemp(join(tmpdir(), 'eval-configuration-'));
  try {
    await mkdir(dirname(join(repo, task.targetFile)), { recursive: true });
    await writeFile(
      join(repo, task.targetFile),
      'export default function Login() { return null; }',
    );
    git(repo, ['init', '-q']);
    const definition = { ...task, repository: { revision: commit(repo) } };
    for (const kind of ['tasks', 'profiles'])
      await mkdir(join(repo, 'evals', kind), { recursive: true });
    await writeFile(join(repo, 'evals/tasks/login-case.json'), JSON.stringify(definition));
    await writeFile(join(repo, 'evals/profiles/smoke.json'), JSON.stringify(profile));
    await run(repo, definition);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}

test('profile limits inherit shared defaults and accept larger explicit per-trial bounds', () => {
  const defaults = profileSchema.parse(profile);
  assert.deepEqual(defaults.limits, DEFAULT_TRIAL_LIMITS);
  const limits = { runtimeMs: 7_200_000, maxTurns: 1000, maxTokens: 10_000_000 };
  assert.deepEqual(taskSchema.parse({ ...task, limits }).limits, limits);
  assert.equal(
    profileSchema.parse({ ...profile, limits: { runtimeMs: limits.runtimeMs } }).limits.runtimeMs,
    limits.runtimeMs,
  );
  for (const maxTurns of [0, -1, 1.5, Number.POSITIVE_INFINITY])
    assert.equal(taskSchema.safeParse({ ...task, limits: { maxTurns } }).success, false);
  assert.equal(
    profileSchema.safeParse({ ...profile, limits: { runtimeMs: 2_147_483_648 } }).success,
    false,
  );
});

test('catalog tasks require repository pins and the supported acceptance path, without legacy grading config', () => {
  assert.equal(taskSchema.parse(task).acceptance, 'admin-login-retry');
  for (const invalid of [
    { ...task, environment: 'synthetic' },
    { ...task, repository: undefined },
    { ...task, repository: { revision: 'main' } },
    { ...task, acceptance: 'admin-login-copy' },
    { ...task, fixture: 'wedding-copy' },
    { ...task, rubric: 'task-clarity' },
    { ...task, graders: ['browser-behavior'] },
    { ...task, title: 'Unused catalog label' },
  ])
    assert.equal(taskSchema.safeParse(invalid).success, false);
});

test('repository catalog discovers a task and validates its pinned target independently of current files', async () => {
  await fixture(async (repo, definition) => {
    assert.deepEqual(await catalogNames(repo, 'tasks'), ['login-case']);
    await rm(join(repo, task.targetFile));
    const loaded = await loadTask(repo, 'login-case');
    assert.equal(loaded.targetFile, task.targetFile);
    assert.deepEqual(loaded.repository, definition.repository);
    assert.equal('fixture' in loaded || 'rubric' in loaded || 'graders' in loaded, false);
  });
});

test('unknown catalog names reject traversal and task IDs must match the filename', async () => {
  await fixture(async (repo, definition) => {
    await assert.rejects(loadTask(repo, 'missing'), /Available: login-case/);
    await assert.rejects(loadTask(repo, '../login-case'), /Unknown task/);
    await writeFile(
      join(repo, 'evals/tasks/login-case.json'),
      JSON.stringify({ ...definition, id: 'other' }),
    );
    await assert.rejects(loadTask(repo, 'login-case'), /must match its filename/);
  });
});

test('target paths reject traversal, absolute paths, backslashes and absent pinned files', async () => {
  await fixture(async (repo, definition) => {
    for (const targetFile of [
      '../outside.tsx',
      '/tmp/outside.tsx',
      'app/../../outside.tsx',
      'app\\outside.tsx',
    ]) {
      await writeFile(
        join(repo, 'evals/tasks/login-case.json'),
        JSON.stringify({ ...definition, targetFile }),
      );
      await assert.rejects(loadTask(repo, 'login-case'), /without \.\. or absolute paths/);
    }
    await writeFile(join(repo, 'untracked.tsx'), 'Not present in the pinned commit');
    for (const targetFile of ['untracked.tsx', 'app/admin/login']) {
      await writeFile(
        join(repo, 'evals/tasks/login-case.json'),
        JSON.stringify({ ...definition, targetFile }),
      );
      await assert.rejects(loadTask(repo, 'login-case'), /regular file at the pinned revision/);
    }
    await writeFile(
      join(repo, 'evals/tasks/login-case.json'),
      JSON.stringify({ ...definition, repository: { revision: '0'.repeat(40) } }),
    );
    await assert.rejects(loadTask(repo, 'login-case'), /regular file at the pinned revision/);
  });
});

test('a symlink stored in the pinned source cannot serve as the task target', async () => {
  await fixture(async (repo, definition) => {
    const targetFile = 'app/admin/login/alias.tsx';
    await symlink('login-form.tsx', join(repo, targetFile));
    const revision = commit(repo);
    await writeFile(
      join(repo, 'evals/tasks/login-case.json'),
      JSON.stringify({ ...definition, targetFile, repository: { revision } }),
    );
    await assert.rejects(loadTask(repo, 'login-case'), /regular file at the pinned revision/);
  });
});

test('native profiles preserve subscription/API billing boundaries and reject removed knobs', async () => {
  await fixture(async (repo) => {
    const loaded = await loadProfile(repo);
    assert.equal(loaded.pi.model, 'gpt-6-luna');
    assert.equal(loaded.maxAgentEstimatedCostUsd, null);
    for (const invalid of [
      { ...profile, pi: { runtime: 'controlled' } },
      { ...profile, pi: { model: '' } },
      { ...profile, pi: { endpoint: 'arbitrary' } },
      { ...profile, grader: { model: 'unused' } },
      { ...profile, harness: 'another' },
      { ...profile, concurrency: 1 },
      { ...profile, runtimeMs: 1000 },
      { ...profile, maxAgentTurns: 100 },
      { ...profile, maxAgentTokens: 1000 },
      { ...profile, maxAgentEstimatedCostUsd: 0.1 },
      { ...profile, agentBilling: 'api' },
    ])
      assert.equal(profileSchema.safeParse(invalid).success, false);
    for (const maxAgentEstimatedCostUsd of [0.1, 2, 100])
      assert.equal(
        profileSchema.parse({ ...profile, agentBilling: 'api', maxAgentEstimatedCostUsd })
          .maxAgentEstimatedCostUsd,
        maxAgentEstimatedCostUsd,
      );
    for (const maxAgentEstimatedCostUsd of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
      assert.equal(
        profileSchema.safeParse({ ...profile, agentBilling: 'api', maxAgentEstimatedCostUsd })
          .success,
        false,
      );
    await assert.rejects(loadProfile(repo, '../smoke'), /Unknown profile/);
  });
});
