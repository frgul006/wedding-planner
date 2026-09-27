import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import type { RecordedTrial } from '../src/index.ts';
import { fileStore } from '../src/adapters/library-file-store.ts';

const execute = promisify(execFile);
const loader = createRequire(import.meta.url).resolve('tsx');
const command = new URL('../src/cli/library-command.ts', import.meta.url).href;

async function setup() {
  const repo = await mkdtemp(path.join(tmpdir(), 'eval-library-cli-'));
  const profile: {
    id: string;
    pi: { model?: string; endpoint?: 'native' | 'catalog' };
    limits: { runtimeMs: number; maxTokens: number; maxTurns: number };
    agentBilling: 'subscription';
    maxAgentEstimatedCostUsd: null;
  } = {
    id: 'offline-native',
    pi: { model: 'explicit-test-model' },
    limits: { runtimeMs: 4_000, maxTokens: 1_000, maxTurns: 100 },
    agentBilling: 'subscription',
    maxAgentEstimatedCostUsd: null,
  };
  for (const folder of ['tasks', 'profiles'])
    await mkdir(path.join(repo, 'evals', folder), { recursive: true });
  await writeFile(path.join(repo, 'evals/profiles/smoke.json'), JSON.stringify(profile));
  await writeFile(path.join(repo, 'index.html'), '<p>Repaired</p>');
  await execute('git', ['init', '--quiet', repo]);
  await execute('git', ['add', 'index.html'], { cwd: repo });
  await execute(
    'git',
    [
      '-c',
      'user.name=Offline test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'Authored fixture',
    ],
    { cwd: repo },
  );
  const revision = (await execute('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim();
  await writeFile(
    path.join(repo, 'evals/tasks/repository-login-retry.json'),
    JSON.stringify({
      id: 'repository-login-retry',
      version: '1',
      prompt: 'Repair retry behavior.',
      repository: { revision },
      acceptance: 'admin-login-retry',
      targetFile: 'index.html',
      expectedText: 'Repaired',
      flowPath: '/',
    }),
  );
  const store = fileStore(path.join(repo, 'saved'));
  async function invoke(args: string[]) {
    // Isolated HOME and system-only PATH prevent developer Pi/credential discovery.
    // Network is disabled inside this process even if a regression tries to dispatch.
    const code = `
      import { libraryCommand } from ${JSON.stringify(command)};
      globalThis.fetch = async () => { throw new Error('Network forbidden in CLI test'); };
      process.exitCode = await libraryCommand(${JSON.stringify(args)}, {
        repo: ${JSON.stringify(repo)}, callerCwd: ${JSON.stringify(repo)},
        signal: new AbortController().signal,
      });
    `;
    try {
      const output = await execute(
        process.execPath,
        ['--import', loader, '--input-type=module', '--eval', code],
        {
          cwd: repo,
          env: { PATH: '/usr/bin:/bin', HOME: repo, NO_COLOR: '1' },
        },
      );
      return { code: 0, ...output };
    } catch (error) {
      const failure = error as Error & { code: number; stdout: string; stderr: string };
      return { code: failure.code, stdout: failure.stdout, stderr: failure.stderr };
    }
  }
  return {
    repo,
    store,
    profile,
    invoke,
    dispose: () => rm(repo, { recursive: true, force: true }),
  };
}

async function saveTrial(store: ReturnType<typeof fileStore>, requiredChecks: string[]) {
  const content = '<p>Repaired</p>';
  const trial: RecordedTrial = {
    id: 'saved-trial',
    task: {
      id: 'retry',
      version: 1,
      prompt: 'Repair retry behavior.',
      metadata: { validation: { required: true, targetFile: 'index.html', requiredChecks } },
    },
    status: 'completed',
    trace: {
      events: [],
      contexts: [],
      complete: true,
      gaps: [],
      artifacts: [
        {
          id: 'final-target',
          path: 'index.html',
          content,
          sha256: createHash('sha256').update(content).digest('hex'),
        },
      ],
    },
    outcome: {},
    metadata: {},
  };
  await store.saveTrial(trial);
  await store.saveRun({
    id: 'saved-run',
    suiteId: 'example',
    trialIds: [trial.id],
    gradingIds: [],
  });
}

test('library preview reads the selected profile and per-trial limits without native Pi or credentials', async () => {
  const context = await setup();
  try {
    const result = await context.invoke(['run', '--dry-run', '--json']);
    assert.equal(result.code, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.profile, context.profile.id);
    assert.equal(plan.model, 'explicit-test-model');
    assert.equal(plan.endpointPolicy, context.profile.pi.endpoint ?? 'native');
    assert.equal(plan.runtimeMs, 4_000);
    assert.equal(plan.maxTokens, 1_000);
    assert.equal(plan.noCalls, true);
    const codeOnly = await context.invoke(['run', '--no-judge', '--dry-run', '--json']);
    assert.equal(codeOnly.code, 0, codeOnly.stderr);
    const codePlan = JSON.parse(codeOnly.stdout);
    assert.equal(codePlan.judge, null);
    assert.deepEqual(codePlan.graders, ['validation-after-final-edit']);
    for (const field of ['revision', 'diagnosisScope', 'budgetUsd'])
      assert.equal(Object.hasOwn(codePlan, field), false, field);

    delete context.profile.pi.model;
    delete context.profile.pi.endpoint;
    context.profile.limits.runtimeMs = 900_000;
    context.profile.limits.maxTokens = 1_500_000;
    await writeFile(
      path.join(context.repo, 'evals/profiles/smoke.json'),
      JSON.stringify(context.profile),
    );
    const nativeDefault = await context.invoke(['run', '--dry-run', '--json']);
    assert.equal(nativeDefault.code, 0, nativeDefault.stderr);
    const nativePlan = JSON.parse(nativeDefault.stdout);
    assert.equal(nativePlan.model, 'native saved model (resolved before prompting)');
    assert.equal(nativePlan.endpointPolicy, 'native');
    assert.equal(nativePlan.runtimeMs, 900_000);
    assert.equal(nativePlan.maxTokens, 1_500_000);
    assert.equal(nativePlan.maxTurns, 100);
    assert.equal(nativePlan.cachedTokenWeight, 0.1);

    const regrade = await context.invoke(['regrade', 'saved-run', '--dry-run', '--json']);
    assert.equal(regrade.code, 0, regrade.stderr);
    assert.equal(Object.hasOwn(JSON.parse(regrade.stdout), 'model'), false);
    const scoped = await context.invoke([
      'regrade',
      'saved-run',
      '--dry-run',
      '--json',
      '--diagnosis-scope',
      'completed-attempt',
      '--revision',
      '2',
    ]);
    assert.equal(scoped.code, 0, scoped.stderr);
    assert.equal(JSON.parse(scoped.stdout).diagnosisScope, 'completed-attempt');
    assert.equal(JSON.parse(scoped.stdout).revision, 2);
    const invalid = await context.invoke([
      'run',
      '--dry-run',
      '--diagnosis-scope',
      'completed-attempt',
    ]);
    assert.notEqual(invalid.code, 0);
    assert.match(invalid.stderr, /with library regrade/);
  } finally {
    await context.dispose();
  }
});

test('library run retains a preparation failure and returns a nonzero execution status', async () => {
  const context = await setup();
  try {
    const result = await context.invoke([
      'run',
      '--no-judge',
      '--json',
      '--store',
      'saved',
      '--agent-source',
      context.repo,
    ]);
    assert.equal(result.code, 2, result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.executionFailed, true);
    assert.equal(summary.trials.length, 1);
    assert.equal(summary.trials[0].status, 'infrastructure_error');
    const run = await context.store.loadRun(summary.id);
    assert.deepEqual(run.trialIds, summary.trialIds);
    const trial = await context.store.loadTrial(run.trialIds[0]!);
    assert.equal(trial.trace.complete, false);
    const gradings = await context.store.listGradings(trial.id);
    assert.equal(gradings[0]!.rollups[0]!.verdict, 'unknown');
    assert.equal(summary.trials[0].gradings[0].trialId, trial.id);
    assert.deepEqual(summary.trials[0].gradings[0].usage, []);
    const shown = await context.invoke(['show', summary.id, '--json', '--store', 'saved']);
    assert.equal(shown.code, 0, shown.stderr);
    assert.deepEqual(JSON.parse(shown.stdout).trials[0].gradings, summary.trials[0].gradings);
  } finally {
    await context.dispose();
  }
});

test('library dry-run resolves task and explicit limits without the former hidden ceilings', async () => {
  const context = await setup();
  try {
    const taskFile = path.join(context.repo, 'evals/tasks/repository-login-retry.json');
    const task = JSON.parse(await readFile(taskFile, 'utf8'));
    task.limits = { runtimeMs: 7_200_000, maxTurns: 750, maxTokens: 8_000_000 };
    await writeFile(taskFile, JSON.stringify(task));
    const fromTask = await context.invoke(['run', '--dry-run', '--json']);
    assert.equal(fromTask.code, 0, fromTask.stderr);
    const taskPlan = JSON.parse(fromTask.stdout);
    for (const [key, value] of Object.entries(task.limits)) assert.equal(taskPlan[key], value);
    const explicit = await context.invoke([
      'run',
      '--dry-run',
      '--json',
      '--max-turns',
      '2',
      '--max-tokens',
      '10000000',
    ]);
    assert.equal(explicit.code, 0, explicit.stderr);
    const plan = JSON.parse(explicit.stdout);
    assert.equal(plan.runtimeMs, 7_200_000);
    assert.equal(plan.maxTurns, 2);
    assert.equal(plan.maxTokens, 10_000_000);
    for (const args of [
      ['run', '--dry-run', '--max-turns', '0'],
      ['run', '--dry-run', '--max-tokens', 'NaN'],
      ['run', '--dry-run', '--max-runtime-ms', '2147483648'],
      ['regrade', 'saved-run', '--dry-run', '--max-turns', '1'],
      ['show', 'saved-run', '--max-tokens', '2'],
    ])
      assert.notEqual((await context.invoke(args)).code, 0, args.join(' '));
  } finally {
    await context.dispose();
  }
});

test('library regrade distinguishes behavioral failure from preparation errors', async () => {
  for (const { requiredChecks, status, verdict, executionFailed } of [
    { requiredChecks: ['test'], status: 0, verdict: 'fail', executionFailed: false },
    { requiredChecks: ['unsupported'], status: 2, verdict: 'unknown', executionFailed: true },
  ]) {
    const context = await setup();
    try {
      await saveTrial(context.store, requiredChecks);
      const trialPath = path.join(context.store.directory, 'trials/saved-trial.json');
      const original = await readFile(trialPath, 'utf8');
      const result = await context.invoke([
        'regrade',
        'saved-run',
        '--no-judge',
        '--json',
        '--store',
        'saved',
      ]);
      assert.equal(result.code, status, result.stderr);
      const summary = JSON.parse(result.stdout);
      assert.equal(summary[0].executionFailed, executionFailed);
      assert.equal(summary[0].rollups[0].verdict, verdict);
      const shown = await context.invoke(['show', 'saved-run', '--json', '--store', 'saved']);
      assert.equal(shown.code, 0, shown.stderr);
      assert.deepEqual(JSON.parse(shown.stdout).trials[0].gradings, summary);
      assert.equal((await context.store.listGradings('saved-trial')).length, 1);
      assert.equal(await readFile(trialPath, 'utf8'), original);
    } finally {
      await context.dispose();
    }
  }
});
