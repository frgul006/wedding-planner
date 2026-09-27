import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { FileRunStore } from '../src/adapters/file-run-store.ts';
import { readSavedRun, selectGrading } from '../src/adapters/saved-runs.ts';
import type { TrialEvidence } from '../src/domain/types.ts';
import { createTrialPlan } from '../src/cli/live-plan.ts';
import { parseCommand } from '../src/cli/arguments.ts';
import { ConsoleOutput } from '../src/cli/output.ts';
import { DEFAULT_TRIAL_LIMITS } from '../src/domain/trial-limits.ts';

const require = createRequire(import.meta.url);
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const exec = promisify(execFile);

async function offlineCli(
  run: (
    invoke: (
      args: string[],
      caller?: string,
      additionalPreload?: string,
    ) => Promise<{ stdout: string; stderr: string }>,
    root: string,
  ) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), 'eval-cli-integration-'));
  try {
    const preload = join(root, 'offline-guard.mjs');
    await writeFile(
      preload,
      `
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
globalThis.fetch = async () => { throw new Error('Offline CLI dispatched a forbidden network request'); };
const gitRead = childProcess.execFileSync;
childProcess.execFileSync = (file, args, ...rest) => {
  if (file !== 'git' || !['rev-parse', 'cat-file', 'ls-tree'].includes(args[0])) throw new Error('Offline CLI dispatched an unexpected process');
  return gitRead(file, args, ...rest);
};
for (const method of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile']) {
  childProcess[method] = () => { throw new Error('Offline CLI attempted to start an agent or browser process'); };
}
syncBuiltinESMExports();
`,
    );
    const invoke = (args: string[], caller = root, additionalPreload?: string) =>
      exec(
        process.execPath,
        [
          '--import',
          require.resolve('tsx'),
          '--import',
          preload,
          ...(additionalPreload ? ['--import', additionalPreload] : []),
          '--',
          cli,
          ...args,
        ],
        { cwd: dirname(cli), env: { ...process.env, INIT_CWD: caller }, timeout: 15_000 },
      );
    await run(invoke, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('complete CLI help and argument errors need no models, browser, credentials or network', async () => {
  await offlineCli(async (invoke) => {
    const help = await invoke(['help', 'run', '--json']);
    assert.match(JSON.parse(help.stdout).help, /--dry-run/);
    assert.equal(help.stderr, '');
    await assert.rejects(invoke(['tasks', '--unknown-option', '--json']), (error) => {
      assert.equal((error as { code: number }).code, 1);
      assert.equal((error as { stdout: string }).stdout, '');
      assert.match(JSON.parse((error as { stderr: string }).stderr).error, /Unknown option/);
      return true;
    });
  });
});

test('complete CLI task discovery, validation and dry-run return clean machine-readable previews offline', async () => {
  await offlineCli(async (invoke, root) => {
    const catalog = await invoke(['tasks', '--json']);
    const tasks = JSON.parse(catalog.stdout).tasks as Array<{ id: string }>;
    assert.ok(tasks.some((task) => task.id === 'ui-copy'));
    assert.ok(tasks.some((task) => task.id === 'docs-only'));
    assert.equal(catalog.stderr, '');
    const validation = await invoke(['validate', '--json']);
    assert.equal(JSON.parse(validation.stdout).valid, true);
    const preview = await invoke([
      'run',
      'ui-copy',
      '--dry-run',
      '--semantic',
      '--grader-env-file',
      join(root, 'does-not-exist.env'),
      '--json',
    ]);
    const result = JSON.parse(preview.stdout);
    assert.equal(result.dryRun, true);
    assert.equal(result.task.id, 'ui-copy');
    assert.equal(result.profile.pi.model, 'gpt-6-luna');
    assert.equal(result.profile.grader.model, 'gpt-5.6-luna');
    assert.equal(result.useGrader, true);
    assert.ok(result.budget.reservedEstimateUsd > 0);
    assert.equal(preview.stderr, '');
    const free = JSON.parse(
      (await invoke(['run', 'docs-only', '--dry-run', '--no-grader', '--json'])).stdout,
    );
    assert.equal(free.useGrader, false);
    assert.equal(free.budget.reservedEstimateUsd, 0);
  });
});

test('one-command experiments preview actual repository tasks and admit the entire API allowance offline', async () => {
  await offlineCli(async (invoke, root) => {
    const preview = JSON.parse((await invoke(['experiment', '--dry-run', '--json'])).stdout);
    assert.equal(preview.task.id, 'repository-ui-copy');
    assert.equal(preview.task.environment, 'repository');
    assert.equal(preview.useGrader, false);
    assert.equal(preview.profile.harness, 'pi');
    assert.match(preview.task.repository.revision, /^[a-f0-9]{40}$/);
    assert.equal(preview.budget.reservedEstimateUsd, 0);
    assert.deepEqual(
      preview.steps.map((step: { variant: string }) => step.variant),
      ['enabled', 'disabled'],
    );
    const repeated = JSON.parse(
      (
        await invoke([
          'experiment',
          'ui-copy',
          '--pairs',
          '2',
          '--semantic',
          '--dry-run',
          '--grader-env-file',
          join(root, 'missing.env'),
          '--budget-usd',
          '0.02',
          '--json',
        ])
      ).stdout,
    );
    assert.equal(repeated.steps.length, 4);
    assert.ok(
      Math.abs(repeated.budget.reservedEstimateUsd - 4 * repeated.budget.perTrialReservationUsd) <
        1e-10,
    );
    await assert.rejects(
      invoke([
        'experiment',
        'ui-copy',
        '--semantic',
        '--dry-run',
        '--budget-usd',
        '0.005',
        '--grader-env-file',
        join(root, 'missing.env'),
        '--json',
      ]),
      (error) => {
        assert.match((error as { stderr: string }).stderr, /budget exceeded before dispatch/);
        assert.doesNotMatch(
          (error as { stderr: string }).stderr,
          /ENOENT|forbidden network|agent or browser/,
        );
        return true;
      },
    );
  });
});

test('trial plans resolve defaults, profile, task and explicit limits before harness preparation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eval-limit-precedence-'));
  const repo = fileURLToPath(new URL('../../../', import.meta.url));
  try {
    for (const folder of ['tasks', 'profiles', 'rubrics', 'fixtures/wedding-copy'])
      await mkdir(join(root, 'evals', folder), { recursive: true });
    await writeFile(join(root, 'evals/fixtures/wedding-copy/index.html'), 'Before');
    await writeFile(join(root, 'evals/rubrics/task-clarity.md'), 'A test rubric.');
    const task = JSON.parse(await readFile(join(repo, 'evals/tasks/ui-copy.json'), 'utf8'));
    const profile = JSON.parse(await readFile(join(repo, 'evals/profiles/smoke.json'), 'utf8'));
    delete profile.runtimeMs;
    delete profile.maxAgentTokens;
    delete profile.maxAgentTurns;
    const taskFile = join(root, 'evals/tasks/ui-copy.json');
    const profileFile = join(root, 'evals/profiles/smoke.json');
    const save = async () => {
      await writeFile(taskFile, JSON.stringify(task));
      await writeFile(profileFile, JSON.stringify(profile));
    };
    const plan = (flags: string[] = []) =>
      createTrialPlan({
        repo: root,
        callerCwd: root,
        request: parseCommand([
          'run',
          'ui-copy',
          '--dry-run',
          '--agent-source',
          root,
          '--grader-env-file',
          join(root, 'unused.env'),
          ...flags,
        ]),
        output: new ConsoleOutput(true),
      });
    const limits = (value: Awaited<ReturnType<typeof createTrialPlan>>) => ({
      runtimeMs: value.profile.runtimeMs,
      maxTurns: value.profile.maxAgentTurns,
      maxTokens: value.profile.maxAgentTokens,
    });
    await save();
    assert.deepEqual(limits(await plan()), DEFAULT_TRIAL_LIMITS);
    Object.assign(profile, { runtimeMs: 120_000, maxAgentTurns: 9, maxAgentTokens: 10_000 });
    await save();
    assert.deepEqual(limits(await plan()), { runtimeMs: 120_000, maxTurns: 9, maxTokens: 10_000 });
    task.limits = { runtimeMs: 240_000, maxTokens: 20_000 };
    await save();
    assert.deepEqual(limits(await plan()), { runtimeMs: 240_000, maxTurns: 9, maxTokens: 20_000 });
    assert.deepEqual(limits(await plan(['--max-turns', '15'])), {
      runtimeMs: 240_000,
      maxTurns: 15,
      maxTokens: 20_000,
    });
    assert.deepEqual(
      limits(
        await plan([
          '--max-runtime-ms',
          '1800000',
          '--max-turns',
          '700',
          '--max-tokens',
          '7000000',
        ]),
      ),
      { runtimeMs: 1_800_000, maxTurns: 700, maxTokens: 7_000_000 },
    );
    assert.equal(await readFile(profileFile, 'utf8'), JSON.stringify(profile));
    assert.equal(await readFile(taskFile, 'utf8'), JSON.stringify(task));
    await assert.rejects(plan(['--max-runtime-ms', '2147483648']), /runtimeMs|timer range/);
    task.limits.maxTokens = 0;
    await save();
    await assert.rejects(plan(), /Invalid evaluation configuration/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('run, experiment and profiles expose weighted token and turn limits without dispatch', async () => {
  await offlineCli(async (invoke) => {
    const flags = ['--max-runtime-ms', '1800000', '--max-turns', '700', '--max-tokens', '7000000'];
    for (const command of ['run', 'experiment']) {
      const preview = JSON.parse(
        (await invoke([command, 'ui-copy', '--dry-run', '--json', ...flags])).stdout,
      );
      assert.equal(preview.profile.runtimeMs, 1_800_000);
      assert.equal(preview.profile.maxAgentTurns, 700);
      assert.equal(preview.profile.maxAgentTokens, 7_000_000);
      assert.equal(preview.cachedTokenWeight, 0.1);
      const human = (await invoke([command, 'ui-copy', '--dry-run', ...flags])).stdout;
      assert.match(human, /7,000,000 weighted tokens · 700 completed assistant turns · 30m 00s/);
      assert.match(human, /Cached tokens count at 10%/);
    }
    const profiles = JSON.parse((await invoke(['profiles', '--json'])).stdout);
    assert.equal(profiles.cachedTokenWeight, 0.1);
    assert(
      profiles.profiles.every((profile: { maxAgentTurns: number }) => profile.maxAgentTurns > 0),
    );
    const human = (await invoke(['profiles'])).stdout;
    assert.match(human, /WEIGHTED TOKENS\s+TURNS/);
    assert.match(human, /Cached tokens count at 10%/);
  });
});

test('full CLI regrading preserves sealed original evidence, including Ctrl-C during semantic grading', async () => {
  await offlineCli(async (invoke, root) => {
    const run = new FileRunStore(join(root, 'results/saved-trial'));
    await run.initialize();
    const evidence: TrialEvidence = {
      task: {
        id: 'docs-only',
        version: '1',
        kind: 'docs',
        prompt: 'Document startup',
        targetFile: 'README.md',
        expectedText: 'pnpm dev',
        flowPath: '/',
      },
      variant: 'enabled',
      localUrl: 'http://127.0.0.1:1234',
      events: [],
      artifacts: [
        {
          id: 'target',
          path: 'README.md',
          sha256: 'offline-test',
          content: 'Start the local server with pnpm dev.',
          observedBy: 'evaluator',
        },
      ],
      agent: {
        status: 'completed',
        startedAt: '2026-09-07T12:00:00Z',
        endedAt: '2026-09-07T12:01:00Z',
        exitCode: 0,
        signal: null,
        model: null,
        thinkingLevel: null,
        events: [],
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          estimatedCostUsd: 0,
          costSource: 'offline test',
        },
      },
    };
    await run.save('evidence.json', evidence);
    await run.save('manifest.json', { id: 'saved-trial', status: 'completed', variant: 'enabled' });
    await run.save('grades.json', []);
    await run.save('report.md', '# Original report');
    await run.seal(['evidence.json', 'manifest.json', 'grades.json', 'report.md']);
    const originalSeal = await readFile(join(run.directory, 'integrity.json'), 'utf8');
    const caller = join(root, 'caller');
    await mkdir(caller);
    const result = await invoke(['regrade', '../results/saved-trial', '--json'], caller);
    const output = JSON.parse(result.stdout);
    assert.equal(output.trialId, 'saved-trial');
    assert.equal(output.semantic, null);
    assert.equal(output.budget.reservedEstimateUsd, 0);
    assert.equal(output.report, join(run.directory, `${output.revision}.md`));
    assert.equal(await readFile(join(run.directory, 'integrity.json'), 'utf8'), originalSeal);
    const saved = await readSavedRun(run.directory);
    assert.equal(selectGrading(saved).id, output.revision);
    assert.deepEqual(saved.warnings, []);
    assert.equal(saved.original.grades.length, 0);
    assert.equal(selectGrading(saved).grades.length, 3);
    const shown = await invoke(['show', '../results/saved-trial', '--json'], caller);
    assert.equal(JSON.parse(shown.stdout).selectedGrading, output.revision);
    assert.equal(shown.stderr, '');

    // Add a registered grader to existing evidence without rewriting the original task.
    const originalEvidence = await readFile(join(run.directory, 'evidence.json'), 'utf8');
    const extended = JSON.parse(
      (
        await invoke(
          ['regrade', '../results/saved-trial', '--graders', 'target-outcome,diff-scope', '--json'],
          caller,
        )
      ).stdout,
    );
    assert.deepEqual(extended.selectedGraders, ['target-outcome', 'diff-scope']);
    assert.deepEqual(
      extended.gradingResults.map((item: { grader: string }) => item.grader),
      ['target-outcome', 'diff-scope'],
    );
    assert.equal(extended.grades[1].verdict, 'not-applicable');
    const extendedSaved = await readSavedRun(run.directory);
    assert.deepEqual(
      (selectGrading(extendedSaved).criteria as { selectedGraders: string[] }).selectedGraders,
      extended.selectedGraders,
    );
    assert.equal(await readFile(join(run.directory, 'evidence.json'), 'utf8'), originalEvidence);
    assert.equal(await readFile(join(run.directory, 'integrity.json'), 'utf8'), originalSeal);
    await assert.rejects(
      invoke(
        [
          'regrade',
          '../results/saved-trial',
          '--graders',
          'missing-grader',
          '--semantic',
          '--grader-env-file',
          join(root, 'missing.env'),
          '--json',
        ],
        caller,
      ),
      (error) => {
        assert.match((error as { stderr: string }).stderr, /Unknown task grader/);
        assert.doesNotMatch((error as { stderr: string }).stderr, /ENOENT|network/);
        return true;
      },
    );
    await assert.rejects(
      invoke(
        ['regrade', '../results/saved-trial', '--graders', 'semantic-task-clarity', '--json'],
        caller,
      ),
      (error) => {
        assert.match((error as { stderr: string }).stderr, /requires --semantic/);
        return true;
      },
    );

    const keyFile = join(root, 'synthetic-grader.env');
    await writeFile(keyFile, 'OPENAI_API_KEY=synthetic-test-key\n');
    const cancelDuringFetch = join(root, 'cancel-during-fetch.mjs');
    await writeFile(
      cancelDuringFetch,
      `
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://api.openai.com/v1/models/'))
    return new Response(JSON.stringify({ id: 'gpt-5.6-luna' }), { status: 200 });
  if (String(url) !== 'https://api.openai.com/v1/responses')
    throw new Error('Unexpected offline request');
  return new Promise((_resolve, reject) => {
    const pendingRequest = setInterval(() => {}, 1000);
    init.signal.addEventListener('abort', () => {
      clearInterval(pendingRequest);
      reject(init.signal.reason);
    }, { once: true });
    setImmediate(() => process.kill(process.pid, 'SIGINT'));
  });
};
`,
    );
    let cancelledOutput:
      | {
          revision: string;
          semantic: { status: string; usage: { estimatedCostUsd: number | null } };
        }
      | undefined;
    await assert.rejects(
      invoke(
        ['regrade', '../results/saved-trial', '--semantic', '--grader-env-file', keyFile, '--json'],
        caller,
        cancelDuringFetch,
      ),
      (error) => {
        const result = error as { code: number; stdout: string; stderr: string };
        assert.equal(result.code, 130);
        assert.match(result.stderr, /Cancelling evaluation/);
        cancelledOutput = JSON.parse(result.stdout);
        assert.equal(cancelledOutput?.semantic.status, 'cancelled');
        assert.equal(cancelledOutput?.semantic.usage.estimatedCostUsd, null);
        return true;
      },
    );
    const afterCancellation = await readSavedRun(run.directory);
    assert.equal(selectGrading(afterCancellation).id, cancelledOutput!.revision);
    assert.equal(selectGrading(afterCancellation).grades.at(-1)?.verdict, 'unknown');
    assert.equal(afterCancellation.evidence.agent.status, 'completed');
    const selectedView = JSON.parse(
      (await invoke(['show', '../results/saved-trial', '--json'], caller)).stdout,
    );
    assert.equal(selectedView.originalSemantic, null);
    assert.equal(selectedView.selectedSemantic.status, 'cancelled');
    assert.equal(selectedView.selectedSemantic.usage.estimatedCostUsd, null);
    assert.deepEqual(afterCancellation.invalidRegrades, []);
    assert.deepEqual(afterCancellation.warnings, []);
    assert.equal(await readFile(join(run.directory, 'integrity.json'), 'utf8'), originalSeal);
  });
});
