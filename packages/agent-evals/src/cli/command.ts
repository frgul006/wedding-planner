import path from 'node:path';
import { parseArgs } from 'node:util';
import { createEvaluator } from '../core/evaluator.ts';
import type { GradingRecord } from '../core/types.ts';
import { fileStore } from '../adapters/files.ts';
import {
  CACHED_TOKEN_WEIGHT,
  DEFAULT_TRIAL_LIMITS,
  resolveTrialLimits,
  type TrialLimits,
} from '../core/trial-limits.ts';
import { loadConfig } from './config.ts';

export const help = `Record, inspect, and regrade agent evaluations

  agent-evals run [--config evals.config.ts]
  agent-evals show RUN_ID
  agent-evals regrade RUN_ID [--config evals.config.ts]

  --config PATH      TypeScript config module (default: ./evals.config.ts)
  --store PATH       Saved records and native recordings (default: ./.agent-evals)
  --code-only        Skip model graders and the judge factory; list skipped graders
  --budget-usd N     Aggregate judge admission estimate (config value or 0.01)
  --repetitions N    Trials per task, from 1 to 10 (run only; default: 1)
  --max-runtime-ms N Per-trial execution deadline in milliseconds (run only)
  --max-turns N      Per-trial completed assistant turns (run only)
  --max-tokens N     Per-trial weighted tokens; cached tokens count 0.1× (run only)
  --dry-run         Preview run/regrade without invoking runner or judge factories
  --json            Machine-readable output
  --help, -h        Show help

Paths are relative to the invoking directory. Config modules default-export an
EvalConfig with a suite and lazy createRunner/createJudge factories. Importing a
config executes its top-level code, including during a dry run. Keep provider and
environment setup inside factories. show never imports config; regrade never
creates a runner. --code-only is explicit and never silently skips model grading.

Trials execute sequentially. Shared defaults are 30 minutes, 100 turns, and
1,000,000 weighted tokens. Runner defaults < task limits < explicit run flags;
the runner must enforce these limits. Any limit hit stops the trial, with possible
in-flight overshoot. Judge budgets are admission estimates, not provider caps.
Regrading appends new grades while retaining the original recording and grades.

Exit 1: command setup/storage failed. Exit 2: recorded execution or grading failed.
A completed behavioral fail or unknown verdict does not change the exit code.
Cancellation exits 130 (SIGINT) or 143 (SIGTERM) after cleanup.
`;

const gradingFailed = (record: GradingRecord) =>
  record.grades.some((grade) => grade.status !== 'completed');

export async function command(
  argv: string[],
  context: { cwd: string; signal: AbortSignal },
): Promise<number> {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      json: { type: 'boolean' },
      config: { type: 'string' },
      store: { type: 'string' },
      'dry-run': { type: 'boolean' },
      'code-only': { type: 'boolean' },
      'budget-usd': { type: 'string' },
      repetitions: { type: 'string' },
      'max-runtime-ms': { type: 'string' },
      'max-turns': { type: 'string' },
      'max-tokens': { type: 'string' },
    },
  });

  const [action = 'help', reference] = parsed.positionals;
  const print = (value: unknown, human?: string) =>
    process.stdout.write(
      (!parsed.values.json && human !== undefined ? human : JSON.stringify(value, null, 2)) + '\n',
    );
  if (parsed.values.help || action === 'help') {
    print({ help }, help);
    return 0;
  }

  if (
    !['run', 'regrade', 'show'].includes(action) ||
    parsed.positionals.length > 2 ||
    (action === 'run' && reference) ||
    (action !== 'run' && !reference)
  ) {
    throw new Error('Use run, regrade RUN_ID, or show RUN_ID');
  }

  for (const flag of ['repetitions', 'max-runtime-ms', 'max-turns', 'max-tokens'] as const) {
    if (parsed.values[flag] !== undefined && action !== 'run') {
      throw new Error(`--${flag} only applies to run`);
    }
  }

  for (const flag of ['config', 'budget-usd', 'code-only', 'dry-run'] as const) {
    if (parsed.values[flag] !== undefined && action === 'show') {
      throw new Error(`--${flag} only applies to run or regrade`);
    }
  }

  if (parsed.values['code-only'] && parsed.values['budget-usd'] !== undefined) {
    throw new Error('--budget-usd cannot be combined with --code-only');
  }
  const limitOverrides: Partial<TrialLimits> = {};
  for (const [flag, key] of [
    ['max-runtime-ms', 'runtimeMs'],
    ['max-turns', 'maxTurns'],
    ['max-tokens', 'maxTokens'],
  ] as const) {
    const value = parsed.values[flag];
    if (value === undefined) {
      continue;
    }
    if (!/^[1-9]\d*$/.test(value)) {
      throw new Error(`--${flag} must be a positive integer`);
    }
    limitOverrides[key] = Number(value);
  }
  resolveTrialLimits(limitOverrides);
  const repetitions = Number(parsed.values.repetitions ?? 1);
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10) {
    throw new Error('--repetitions must be an integer between 1 and 10');
  }

  const directory = path.resolve(context.cwd, parsed.values.store ?? '.agent-evals');
  const recordingsDirectory = path.join(directory, 'recordings');
  const gradingSummary = (record: GradingRecord) => ({
    id: record.id,
    trialId: record.trialId,
    executionFailed: gradingFailed(record),
    rollups: record.rollups,
    report: path.join(directory, 'gradings', record.id, 'report.md'),
    usage: record.requests.map((entry) => entry.response?.usage ?? entry.observedUsage ?? null),
  });

  const store = fileStore(directory);
  if (action === 'show') {
    const run = await store.loadRun(reference!);
    const trials = await Promise.all(
      run.trialIds.map(async (id) => {
        const trial = await store.loadTrial(id);
        return {
          id,
          status: trial.status,
          outcome: trial.outcome,
          gradings: (await store.listGradings(id)).map(gradingSummary),
        };
      }),
    );
    print({ run, trials });
    return 0;
  }

  const configPath = path.resolve(context.cwd, parsed.values.config ?? 'evals.config.ts');
  const config = await loadConfig(configPath);
  const skippedModelGraders = parsed.values['code-only']
    ? config.suite.graders.filter((grader) => grader.kind === 'model').map((grader) => grader.id)
    : [];
  const graders = parsed.values['code-only']
    ? config.suite.graders.filter((grader) => grader.kind === 'code')
    : config.suite.graders;
  const needsJudge = graders.some((grader) => grader.kind === 'model');
  if (!needsJudge && parsed.values['budget-usd'] !== undefined) {
    throw new Error('--budget-usd requires at least one selected model grader');
  }
  const budgetFlag = parsed.values['budget-usd'];
  const budgetUsd = budgetFlag === undefined ? (config.budgetUsd ?? 0.01) : Number(budgetFlag);
  if (budgetFlag?.trim() === '' || !Number.isFinite(budgetUsd) || budgetUsd < 0) {
    throw new Error('--budget-usd must be a finite nonnegative number');
  }
  if (action === 'run' && !config.createRunner) {
    throw new Error('Config must provide createRunner for run');
  }
  if (needsJudge && !config.createJudge) {
    throw new Error(
      'Config must provide createJudge for model graders; use --code-only to skip them',
    );
  }

  if (parsed.values['dry-run']) {
    print({
      action,
      config: configPath,
      suite: config.suite.id,
      store: directory,
      ...(action === 'run'
        ? {
            recordingsDirectory,
            tasks: config.suite.tasks.map((task) => ({
              id: task.id,
              version: task.version,
              limits: task.limits ?? {},
            })),
            repetitions,
            defaultLimits: DEFAULT_TRIAL_LIMITS,
            limitOverrides,
            cachedTokenWeight: CACHED_TOKEN_WEIGHT,
          }
        : { run: reference }),
      graders: graders.map(({ id, kind, version }) => ({ id, kind, version })),
      skippedModelGraders,
      ...(needsJudge ? { budgetUsd } : {}),
      factoriesInvoked: false,
    });
    return 0;
  }

  context.signal.throwIfAborted();
  const judge = needsJudge ? await config.createJudge!() : undefined;
  const runner =
    action === 'run'
      ? await config.createRunner!({ storeDirectory: directory, recordingsDirectory })
      : undefined;
  const evaluator = createEvaluator({ store, runner, judge, budgetUsd });

  if (!parsed.values.json) {
    process.stderr.write(
      action === 'run'
        ? 'Running trials sequentially; saving evidence before grading…\n'
        : 'Preparing and grading saved evidence…\n',
    );
  }
  const timer = setInterval(() => {
    if (!parsed.values.json) {
      process.stderr.write('Evaluation is still running; captured evidence is being retained…\n');
    }
  }, 30_000);
  try {
    if (action === 'run') {
      const run = await evaluator.run(
        { ...config.suite, graders },
        { repetitions, signal: context.signal, limits: limitOverrides },
      );
      const trials = await Promise.all(
        run.trialIds.map(async (id) => ({
          id,
          status: (await store.loadTrial(id)).status,
          gradings: (await store.listGradings(id))
            .filter((record) => run.gradingIds.includes(record.id))
            .map(gradingSummary),
        })),
      );
      const failed = trials.some(
        ({ status, gradings }) => status !== 'completed' || gradings.some((g) => g.executionFailed),
      );
      print({ ...run, executionFailed: failed, skippedModelGraders, trials });
      return failed ? 2 : 0;
    }
    const records = await evaluator.regrade(reference!, { graders, signal: context.signal });
    print({ run: reference, skippedModelGraders, gradings: records.map(gradingSummary) });
    return records.some(gradingFailed) ? 2 : 0;
  } finally {
    clearInterval(timer);
  }
}
