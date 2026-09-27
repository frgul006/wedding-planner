import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const loader = createRequire(import.meta.url).resolve('tsx');
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const execute = promisify(execFile);

async function setup() {
  const cwd = await realpath(await mkdtemp(path.join(tmpdir(), 'agent-evals-cli-')));
  await writeFile(path.join(cwd, 'package.json'), JSON.stringify({ type: 'module' }));
  const preload = path.join(cwd, 'offline.mjs');
  await writeFile(
    preload,
    `globalThis.fetch = async () => { throw new Error('Network forbidden'); };`,
  );
  return {
    cwd,
    config: (content: string) => writeFile(path.join(cwd, 'evals.config.ts'), content),
    invoke: (args: string[]) =>
      execute(process.execPath, ['--import', loader, '--import', preload, cli, ...args], {
        cwd,
        env: {
          PATH: '/usr/bin:/bin',
          HOME: cwd,
          INIT_CWD: '/not-the-invoking-directory',
          NO_COLOR: '1',
        },
        timeout: 15_000,
      }),
    dispose: () => rm(cwd, { recursive: true, force: true }),
  };
}

const config = `
const view = { id: 'visible', version: 1, prepare: () => [{
  id: 'answer', data: 'Authored offline evidence', scope: 'The answer', sourceRefs: [],
  coverage: {complete: true, gaps: []}, omissions: [], applicability: 'applicable'
}] };
export default {
  suite: { id: 'independent', tasks: [{id: 'write', version: 1, prompt: 'Write an answer',
    limits: {runtimeMs: 4000, maxTurns: 3}}], graders: [
    {id: 'literal', kind: 'code', version: 1, view, check: () => ({verdict: 'fail'})},
    {id: 'semantic', kind: 'model', version: 1, view, question: 'Is it clear?',
      rubric: {pass: 'Clear', fail: 'Unclear', unknown: 'Missing'}}
  ]},
  createJudge() { throw new Error('Judge factory must not run'); },
  createRunner(context) { return { async run(task, request) { return {
    id: request.trialId, task, status: 'completed',
    trace: {events: [], contexts: [], artifacts: [], complete: true, gaps: []},
    outcome: {context, limits: request.limits}, metadata: {}
  }; }}; }
};`;

function failedWith(code: number, pattern: RegExp) {
  return (error: unknown) => {
    const failure = error as { code: number; stdout: string; stderr: string };
    assert.equal(failure.code, code);
    assert.equal(failure.stdout, '');
    assert.match(JSON.parse(failure.stderr).error, pattern);
    return true;
  };
}

test('help and irrelevant/unknown flags fail without importing config', async () => {
  const context = await setup();
  try {
    await context.config(`throw new Error('Config imported unexpectedly');`);
    for (const args of [[], ['--help'], ['-h'], ['help']]) {
      const result = await context.invoke(args);
      assert.match(result.stdout, /agent-evals regrade RUN_ID/);
      assert.doesNotMatch(result.stdout, /Luna|wedding|key-file|library run/);
      assert.equal(result.stderr, '');
    }
    for (const args of [
      ['show', 'run', '--config', 'unused.ts'],
      ['show', 'run', '--code-only'],
      ['show', 'run', '--dry-run'],
      ['show', 'run', '--budget-usd', '1'],
      ['regrade', 'run', '--repetitions', '2'],
      ['regrade', 'run', '--max-turns', '2'],
      ['run', '--code-only', '--budget-usd', '1'],
      ['run', '--unknown'],
      ['library', 'run'],
    ])
      await assert.rejects(
        context.invoke([...args, '--json']),
        failedWith(1, /only applies|cannot be combined|Unknown option|Use run/),
      );
  } finally {
    await context.dispose();
  }
});

test('dry-run imports local TypeScript config but invokes neither factory', async () => {
  const context = await setup();
  try {
    await context.config(
      config.replace(
        'createRunner(context) {',
        "createRunner(context) { throw new Error('Runner must not run');",
      ),
    );
    const preview = JSON.parse(
      (
        await context.invoke([
          'run',
          '--dry-run',
          '--json',
          '--max-turns',
          '7',
          '--repetitions',
          '2',
        ])
      ).stdout,
    );
    assert.equal(preview.config, path.join(context.cwd, 'evals.config.ts'));
    assert.equal(preview.store, path.join(context.cwd, '.agent-evals'));
    assert.equal(preview.recordingsDirectory, path.join(context.cwd, '.agent-evals/recordings'));
    assert.deepEqual(preview.limitOverrides, { maxTurns: 7 });
    assert.deepEqual(preview.defaultLimits, {
      runtimeMs: 1800000,
      maxTurns: 100,
      maxTokens: 1000000,
    });
    assert.equal(preview.repetitions, 2);
    assert.equal(preview.cachedTokenWeight, 0.1);
    assert.equal(preview.factoriesInvoked, false);
    assert.equal(preview.budgetUsd, 0.01);
    const codeOnly = JSON.parse(
      (await context.invoke(['regrade', 'saved', '--dry-run', '--code-only', '--json'])).stdout,
    );
    assert.deepEqual(codeOnly.skippedModelGraders, ['semantic']);
    assert.equal('budgetUsd' in codeOnly, false);
    assert.equal('limitOverrides' in codeOnly, false);
  } finally {
    await context.dispose();
  }
});

test('run preserves limits and skipped graders; show ignores config and regrade preserves recordings', async () => {
  const context = await setup();
  try {
    await context.config(config);
    const run = JSON.parse(
      (
        await context.invoke([
          'run',
          '--code-only',
          '--json',
          '--store',
          'saved',
          '--max-turns',
          '7',
          '--repetitions',
          '2',
        ])
      ).stdout,
    );
    assert.equal(run.executionFailed, false); // A behavioral fail is not an infrastructure failure.
    assert.equal(run.trialIds.length, 2);
    assert.deepEqual(run.skippedModelGraders, ['semantic']);
    assert.equal(run.trials[0].gradings[0].rollups[0].verdict, 'fail');
    const originalPath = path.join(context.cwd, 'saved/trials', run.trialIds[0] + '.json');
    const original = await readFile(originalPath, 'utf8');
    const saved = JSON.parse(original).value;
    assert.deepEqual(saved.outcome.limits, { runtimeMs: 4000, maxTurns: 7 });
    assert.deepEqual(saved.outcome.context, {
      storeDirectory: path.join(context.cwd, 'saved'),
      recordingsDirectory: path.join(context.cwd, 'saved/recordings'),
    });
    await context.config(`throw new Error('show must not import config');`);
    const shown = JSON.parse(
      (await context.invoke(['show', run.id, '--store', 'saved', '--json'])).stdout,
    );
    assert.equal(shown.trials.length, 2);
    await context.config(
      config.replace(
        'createRunner(context) {',
        "createRunner(context) { throw new Error('Regrade must not create runner');",
      ),
    );
    const regraded = JSON.parse(
      (await context.invoke(['regrade', run.id, '--store', 'saved', '--code-only', '--json']))
        .stdout,
    );
    assert.equal(regraded.gradings.length, 2);
    assert.deepEqual(regraded.skippedModelGraders, ['semantic']);
    assert.equal(await readFile(originalPath, 'utf8'), original);
    assert.notEqual(regraded.gradings[0].id, run.gradingIds[0]);
  } finally {
    await context.dispose();
  }
});

test('setup errors and recorded execution errors have distinct exit codes', async () => {
  const context = await setup();
  try {
    await context.config(`export default {};`);
    await assert.rejects(context.invoke(['run', '--json']), failedWith(1, /Config suite/));
    await context.config(config.replace("kind: 'code'", "kind: 'cod'"));
    await assert.rejects(
      context.invoke(['run', '--code-only', '--json']),
      failedWith(1, /kind code or model/),
    );
    await context.config(config.replace('createJudge()', 'unusedJudge()'));
    await assert.rejects(context.invoke(['run', '--json']), failedWith(1, /createJudge/));
    await context.config(config.replace("status: 'completed'", "status: 'budget_exceeded'"));
    await assert.rejects(context.invoke(['run', '--code-only', '--json']), (error) => {
      const failure = error as { code: number; stdout: string; stderr: string };
      assert.equal(failure.code, 2);
      assert.equal(failure.stderr, '');
      const result = JSON.parse(failure.stdout);
      assert.equal(result.executionFailed, true);
      assert.equal(result.trials[0].status, 'budget_exceeded');
      return true;
    });
  } finally {
    await context.dispose();
  }
});
