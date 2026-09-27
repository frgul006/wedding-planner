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
  const profile = JSON.parse(
    await readFile(new URL('../../../evals/profiles/smoke.json', import.meta.url), 'utf8'),
  );
  profile.pi.model = 'explicit-test-model';
  profile.runtimeMs = 4_000;
  profile.maxAgentTokens = 1_000;
  for (const folder of ['tasks', 'profiles', 'rubrics', 'fixtures/wedding-copy'])
    await mkdir(path.join(repo, 'evals', folder), { recursive: true });
  await mkdir(path.join(repo, 'empty-bin'));
  await writeFile(path.join(repo, 'evals/profiles/smoke.json'), JSON.stringify(profile));
  await writeFile(path.join(repo, 'evals/rubrics/test.md'), 'Observe the repair.');
  await writeFile(path.join(repo, 'evals/fixtures/wedding-copy/index.html'), '<p>Repaired</p>');
  await writeFile(
    path.join(repo, 'evals/tasks/repository-login-retry.json'),
    JSON.stringify({
      id: 'repository-login-retry',
      version: '1',
      kind: 'ui',
      prompt: 'Repair retry behavior.',
      fixture: 'wedding-copy',
      rubric: 'test',
      targetFile: 'index.html',
      expectedText: 'Repaired',
      flowPath: '/',
    }),
  );
  const store = fileStore(path.join(repo, 'saved'));
  async function invoke(args: string[]) {
    // Empty PATH and HOME prevent Pi discovery and access to developer credentials.
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
          env: { PATH: path.join(repo, 'empty-bin'), HOME: repo, NO_COLOR: '1' },
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

test('library preview reads the selected profile and tighter limits without native Pi or credentials', async () => {
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

    delete context.profile.pi.model;
    delete context.profile.pi.endpoint;
    context.profile.runtimeMs = 900_000;
    context.profile.maxAgentTokens = 1_500_000;
    await writeFile(
      path.join(context.repo, 'evals/profiles/smoke.json'),
      JSON.stringify(context.profile),
    );
    const nativeDefault = await context.invoke(['run', '--dry-run', '--json']);
    assert.equal(nativeDefault.code, 0, nativeDefault.stderr);
    const nativePlan = JSON.parse(nativeDefault.stdout);
    assert.equal(nativePlan.model, 'native saved model (resolved before prompting)');
    assert.equal(nativePlan.endpointPolicy, 'native');
    assert.equal(nativePlan.runtimeMs, 360_000);
    assert.equal(nativePlan.maxTokens, 350_000);

    const regrade = await context.invoke(['regrade', 'saved-run', '--dry-run', '--json']);
    assert.equal(regrade.code, 0, regrade.stderr);
    assert.equal(Object.hasOwn(JSON.parse(regrade.stdout), 'model'), false);
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
      assert.equal((await context.store.listGradings('saved-trial')).length, 1);
      assert.equal(await readFile(trialPath, 'utf8'), original);
    } finally {
      await context.dispose();
    }
  }
});
