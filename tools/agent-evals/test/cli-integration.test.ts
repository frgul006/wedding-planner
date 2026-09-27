import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { fileStore } from '../src/adapters/library-file-store.ts';

const loader = createRequire(import.meta.url).resolve('tsx');
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const execute = promisify(execFile);

async function offlineCli() {
  const root = await mkdtemp(path.join(tmpdir(), 'eval-cli-integration-'));
  const preload = path.join(root, 'offline-guard.mjs');
  await writeFile(
    preload,
    `
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
globalThis.fetch = async () => { throw new Error('Offline CLI attempted a network request'); };
const gitRead = childProcess.execFileSync;
childProcess.execFileSync = (file, args, ...rest) => {
  if (file !== 'git' || !['rev-parse', 'cat-file', 'ls-tree'].includes(args[0]))
    throw new Error('Offline CLI attempted an unexpected process');
  return gitRead(file, args, ...rest);
};
for (const method of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile']) {
  childProcess[method] = () => { throw new Error('Offline CLI attempted an agent or browser process'); };
}
syncBuiltinESMExports();
`,
  );
  return {
    root,
    store: fileStore(path.join(root, 'saved')),
    invoke: (args: string[]) =>
      execute(process.execPath, ['--import', loader, '--import', preload, '--', cli, ...args], {
        cwd: root,
        env: { PATH: '/usr/bin:/bin', HOME: root, INIT_CWD: root, NO_COLOR: '1' },
        timeout: 15_000,
      }),
    dispose: () => rm(root, { recursive: true, force: true }),
  };
}

test('the sole CLI exposes library help and rejects old workflows without dispatch', async () => {
  const context = await offlineCli();
  try {
    for (const args of [[], ['--help'], ['-h'], ['help'], ['library']]) {
      const result = await context.invoke(args);
      assert.match(result.stdout, /pnpm evals library run/);
      assert.doesNotMatch(result.stdout, /grader-smoke|experiment|--semantic|--grader-env-file/);
      assert.equal(result.stderr, '');
    }
    const help = await context.invoke(['library', '--help', '--json']);
    assert.match(JSON.parse(help.stdout).help, /library regrade RUN_ID/);
    for (const command of [
      'run',
      'experiment',
      'grader-smoke',
      'tasks',
      'profiles',
      'validate',
      'runs',
      'show',
      'regrade',
      'compare',
      'doctor',
    ]) {
      await assert.rejects(context.invoke([command, '--json']), (error) => {
        const failure = error as { code: number; stdout: string; stderr: string };
        assert.equal(failure.code, 1);
        assert.equal(failure.stdout, '');
        assert.match(JSON.parse(failure.stderr).error, /Use pnpm evals library/);
        return true;
      });
    }
    await assert.rejects(
      context.invoke(['library', 'run', '--unknown-option', '--json']),
      (error) => {
        assert.match(JSON.parse((error as { stderr: string }).stderr).error, /Unknown option/);
        return true;
      },
    );
  } finally {
    await context.dispose();
  }
});

test('the full CLI previews native limits and resolves paths from the caller without credentials', async () => {
  const context = await offlineCli();
  try {
    const result = await context.invoke([
      'library',
      'run',
      '--dry-run',
      '--json',
      '--store',
      'saved',
      '--key-file',
      'missing.env',
      '--max-runtime-ms',
      '2000000',
      '--max-turns',
      '700',
      '--max-tokens',
      '7000000',
    ]);
    const plan = JSON.parse(result.stdout);
    assert.equal(result.stderr, '');
    assert.equal(plan.task, 'repository-login-retry');
    assert.equal(plan.model, 'gpt-6-luna');
    assert.equal(plan.runtimeMs, 2_000_000);
    assert.equal(plan.maxTurns, 700);
    assert.equal(plan.maxTokens, 7_000_000);
    assert.equal(plan.cachedTokenWeight, 0.1);
    assert.equal(plan.store, context.store.directory);
    assert.equal(plan.judge, 'jev-1.13.0');
    assert.equal(plan.noCalls, true);
  } finally {
    await context.dispose();
  }
});

test('the full CLI shows and regrades saved records without rewriting the trial', async () => {
  const context = await offlineCli();
  try {
    const content = 'Saved original evidence';
    await context.store.saveTrial({
      id: 'saved-trial',
      task: {
        id: 'docs',
        version: 1,
        prompt: 'Document local setup.',
        metadata: { validation: { required: false } },
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
            path: 'README.md',
            content,
            sha256: createHash('sha256').update(content).digest('hex'),
          },
        ],
      },
      outcome: {},
      metadata: {},
    });
    await context.store.saveRun({
      id: 'saved-run',
      suiteId: 'docs',
      trialIds: ['saved-trial'],
      gradingIds: [],
    });
    const originalPath = path.join(context.store.directory, 'trials/saved-trial.json');
    const original = await readFile(originalPath, 'utf8');
    for (let count = 1; count <= 2; count++) {
      const result = await context.invoke([
        'library',
        'regrade',
        'saved-run',
        '--store',
        'saved',
        '--no-judge',
        '--json',
      ]);
      const grading = JSON.parse(result.stdout)[0];
      assert.equal(result.stderr, '');
      assert.equal(grading.executionFailed, false);
      assert.equal(grading.rollups[0].verdict, 'not_applicable');
      assert.match(await readFile(grading.report, 'utf8'), /validation-after-final-edit/);
      assert.equal((await context.store.listGradings('saved-trial')).length, count);
      assert.equal(await readFile(originalPath, 'utf8'), original);
    }
    const shown = await context.invoke([
      'library',
      'show',
      'saved-run',
      '--store',
      'saved',
      '--json',
    ]);
    const summary = JSON.parse(shown.stdout);
    assert.equal(shown.stderr, '');
    assert.equal(summary.trials[0].id, 'saved-trial');
    assert.equal(summary.trials[0].gradings.length, 2);
    assert.ok(
      summary.trials[0].gradings.every((record: { usage: unknown[] }) => record.usage.length === 0),
    );
  } finally {
    await context.dispose();
  }
});

test('the CLI rejects options that have no effect for the selected operation', async () => {
  const context = await offlineCli();
  try {
    for (const args of [
      ['regrade', 'saved-run', '--agent-source', '/unused'],
      ['show', 'saved-run', '--agent-source', '/unused'],
      ['show', 'saved-run', '--revision', '2'],
      ['show', 'saved-run', '--budget-usd', '0.01'],
      ['show', 'saved-run', '--key-file', 'unused.env'],
      ['show', 'saved-run', '--no-judge'],
      ['show', 'saved-run', '--dry-run'],
      ['run', '--no-judge', '--revision', '2'],
      ['run', '--no-judge', '--key-file', 'unused.env'],
      ['run', '--no-judge', '--budget-usd', '0.01'],
      ['regrade', 'saved-run', '--no-judge', '--diagnosis-scope', 'completed-attempt'],
    ]) {
      await assert.rejects(context.invoke(['library', ...args, '--json']), (error) => {
        const failure = error as { code: number; stdout: string; stderr: string };
        assert.equal(failure.code, 1);
        assert.equal(failure.stdout, '');
        assert.match(JSON.parse(failure.stderr).error, /only applies|cannot be combined/);
        return true;
      });
    }
  } finally {
    await context.dispose();
  }
});
