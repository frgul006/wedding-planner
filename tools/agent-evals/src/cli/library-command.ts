import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, parseEnv } from 'node:util';
import { createEvaluator } from '../index.ts';
import type { Grader, GradingRecord, Suite } from '../index.ts';
import { fileStore } from '../adapters/library-file-store.ts';
import { loadProfile, loadTask } from '../adapters/evaluation-config.ts';
import { defaultEnvFile } from '../adapters/secrets.ts';
import {
  CACHED_TOKEN_WEIGHT,
  resolveTrialLimits,
  type TrialLimits,
} from '../domain/trial-limits.ts';
import {
  diagnosis,
  completedDiagnosis,
  falsifiableHypothesis,
  relevantProbe,
  finalValidation,
} from '../examples/diagnosis.ts';

export const libraryHelp = `Inspect and regrade diagnostic evidence with Jev

  pnpm evals library run --dry-run
  pnpm evals library run
  pnpm evals library show RUN_ID
  pnpm evals library regrade RUN_ID --revision 2

run makes one bounded native Luna trial of repository-login-retry, then grades it.
regrade uses saved evidence only; revision 2 demonstrates a sharpened question.
show reads local records without model calls. Core/adapter APIs are separately exported.

  --store PATH        Saved library records (default: evals/runs/library)
  --key-file PATH     Reads only TYPESAFE_API_KEY (default: worktree .env.local)
  --budget-usd N      Aggregate Jev admission estimate (default: 0.01, maximum: 1)
  --agent-source PATH Native Pi resource checkout (default: original checkout)
  --profile NAME      Runtime profile for run (default: smoke)
  --max-runtime-ms N  Per-trial agent deadline in milliseconds
  --max-turns N       Per-trial completed assistant turns (including tool results)
  --max-tokens N      Per-trial weighted token limit (cached tokens count 0.1×)
  --revision 1|2      Example diagnostic question version (default: 1)
  --diagnosis-scope entire|completed-attempt
                      Regrade the whole saved diagnosis (default), or only its
                      initial statement through the first completed test attempt
  --no-judge          Run only the deterministic validation grader
  --dry-run           Preview the example without credentials, Pi or Jev
  --json              Machine-readable output

Pi uses its existing subscription and saved reasoning, with the smoke profile's
model (currently Luna). Defaults are 30 minutes, 100 turns and 1,000,000 weighted
tokens per trial. Profile < task limits < explicit run flags; any limit hit stops
the trial. Runtime covers Pi startup/execution, excluding environment setup and grading.
No automatic agent retries. Jev uses its
separate key, version jev-1.13.0, concurrency 1 and no retries. These estimates are
application limits, not provider-enforced caps. Limits can overshoot in flight.
Exit 2 means execution, preparation or grading failed. A completed behavioral
fail or unknown verdict is reported separately and does not change the exit code.
`;

const gradingFailed = (record: GradingRecord) =>
  record.grades.some((grade) => grade.status !== 'completed');

function exampleGraders(revision: number, noJudge: boolean, scoped: boolean): Grader[] {
  if (noJudge) return [finalValidation];
  const view = scoped ? completedDiagnosis : diagnosis;
  const hypothesis =
    revision === 1
      ? { ...falsifiableHypothesis, view }
      : {
          ...falsifiableHypothesis,
          version: 2,
          view,
          question:
            'Before the probe, did the visible hypothesis predict a concrete observable result whose opposite would disprove it? A repair plan or a conclusion stated after the result is insufficient.',
        };
  return [hypothesis, { ...relevantProbe, view }, finalValidation];
}

export async function libraryCommand(
  argv: string[],
  context: {
    repo: string;
    callerCwd: string;
    signal: AbortSignal;
  },
): Promise<number> {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      help: { type: 'boolean' },
      json: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      'no-judge': { type: 'boolean' },
      store: { type: 'string' },
      'key-file': { type: 'string' },
      'budget-usd': { type: 'string' },
      'agent-source': { type: 'string' },
      profile: { type: 'string' },
      'max-runtime-ms': { type: 'string' },
      'max-turns': { type: 'string' },
      'max-tokens': { type: 'string' },
      revision: { type: 'string' },
      'diagnosis-scope': { type: 'string' },
    },
  });
  const [action = 'help', reference] = parsed.positionals;
  const print = (value: unknown, human: string) =>
    process.stdout.write(parsed.values.json ? JSON.stringify(value, null, 2) + '\n' : human + '\n');
  if (parsed.values.help || action === 'help') {
    print({ help: libraryHelp }, libraryHelp);
    return 0;
  }
  if (
    !['run', 'regrade', 'show'].includes(action) ||
    parsed.positionals.length > 2 ||
    (action === 'run' && reference) ||
    (action !== 'run' && !reference)
  )
    throw new Error('Use library run, library regrade RUN_ID, or library show RUN_ID');
  const limitOverrides: Partial<TrialLimits> = {};
  for (const [flag, key] of [
    ['max-runtime-ms', 'runtimeMs'],
    ['max-turns', 'maxTurns'],
    ['max-tokens', 'maxTokens'],
  ] as const) {
    const value = parsed.values[flag];
    if (value === undefined) continue;
    if (action !== 'run') throw new Error(`--${flag} only applies to library run`);
    if (!/^[1-9]\d*$/.test(value)) throw new Error(`--${flag} must be a positive integer`);
    limitOverrides[key] = Number(value);
  }
  resolveTrialLimits(limitOverrides);
  if (parsed.values.profile !== undefined && action !== 'run')
    throw new Error('--profile only applies to library run');
  const revision = Number(parsed.values.revision ?? 1);
  const diagnosisScope = parsed.values['diagnosis-scope'] ?? 'entire';
  if (
    !['entire', 'completed-attempt'].includes(diagnosisScope) ||
    (parsed.values['diagnosis-scope'] !== undefined && action !== 'regrade')
  )
    throw new Error('Use --diagnosis-scope entire or completed-attempt with library regrade.');
  const budgetUsd = Number(parsed.values['budget-usd'] ?? 0.01);
  if (![1, 2].includes(revision) || !Number.isFinite(budgetUsd) || budgetUsd < 0 || budgetUsd > 1)
    throw new Error('Use revision 1 or 2 and a judge budget between 0 and 1 USD');
  const directory = parsed.values.store
    ? path.resolve(context.callerCwd, parsed.values.store)
    : path.join(context.repo, 'evals/runs/library');
  const store = fileStore(directory);
  if (action === 'show') {
    const run = await store.loadRun(reference!);
    const trials = await Promise.all(
      run.trialIds.map(async (id) => ({
        trial: await store.loadTrial(id),
        gradings: await store.listGradings(id),
      })),
    );
    const summaries = trials.map(({ trial, gradings }) => ({
      id: trial.id,
      status: trial.status,
      outcome: trial.outcome,
      gradings: gradings.map((grading) => ({
        id: grading.id,
        rollups: grading.rollups,
        report: path.join(directory, 'gradings', grading.id, 'report.md'),
        usage: grading.requests.map(
          (entry) => entry.response?.usage ?? entry.observedUsage ?? null,
        ),
      })),
    }));
    print({ run, trials: summaries }, JSON.stringify({ run, trials: summaries }, null, 2));
    return 0;
  }
  const graders = exampleGraders(
    revision,
    parsed.values['no-judge'] ?? false,
    diagnosisScope === 'completed-attempt',
  );
  const task =
    action === 'run' ? await loadTask(context.repo, 'repository-login-retry') : undefined;
  const profile =
    action === 'run' ? await loadProfile(context.repo, parsed.values.profile) : undefined;
  const agentModel = profile?.pi.model ?? 'native saved model (resolved before prompting)';
  const limits = resolveTrialLimits(
    profile
      ? {
          runtimeMs: profile.runtimeMs,
          maxTurns: profile.maxAgentTurns,
          maxTokens: profile.maxAgentTokens,
        }
      : undefined,
    task?.limits,
    limitOverrides,
  );
  if (parsed.values['dry-run']) {
    const plan = {
      action,
      task: task?.id,
      run: reference,
      ...(profile
        ? {
            profile: profile.id,
            model: agentModel,
            endpointPolicy: profile.pi.endpoint ?? 'native',
            ...limits,
            cachedTokenWeight: CACHED_TOKEN_WEIGHT,
          }
        : {}),
      judge: parsed.values['no-judge'] ? null : 'jev-1.13.0',
      revision,
      diagnosisScope,
      budgetUsd,
      graders: graders.map((grader) => grader.id),
      store: directory,
      noCalls: true,
    };
    print(plan, JSON.stringify(plan, null, 2));
    return 0;
  }
  let judge;
  if (!parsed.values['no-judge']) {
    const keyFile = parsed.values['key-file']
      ? path.resolve(context.callerCwd, parsed.values['key-file'])
      : path.join(context.repo, '.env.local');
    const key = parseEnv(await readFile(keyFile, 'utf8')).TYPESAFE_API_KEY?.trim();
    if (!key) throw new Error(`TYPESAFE_API_KEY is missing or empty in ${keyFile}`);
    const { jevJudge } = await import('../adapters/jev-judge.ts');
    judge = jevJudge({
      apiKey: key,
      ...(diagnosisScope === 'completed-attempt' ? { maxStateChars: 30_000 } : {}),
    });
  }
  let runner;
  if (action === 'run') {
    const { piRunner } = await import('../adapters/pi-runner.ts');
    runner = piRunner({
      sourceRepo: context.repo,
      agentSource: parsed.values['agent-source']
        ? path.resolve(context.callerCwd, parsed.values['agent-source'])
        : path.dirname(defaultEnvFile(context.repo)),
      profile: parsed.values.profile,
    });
  }
  const evaluator = createEvaluator({ store, runner, judge, budgetUsd });
  if (!parsed.values.json)
    process.stderr.write(
      action === 'run'
        ? `Running one ${agentModel} trial; limits: ${limits.runtimeMs}ms, ${limits.maxTurns} turns, ${limits.maxTokens} weighted tokens (cached ×0.1); saving evidence before grading…\n`
        : 'Preparing and grading saved evidence; Pi will not run…\n',
    );
  const timer = setInterval(() => {
    if (!parsed.values.json)
      process.stderr.write('Evaluation is still running; recorded evidence is being retained…\n');
  }, 30_000);
  try {
    if (action === 'run') {
      const suite: Suite = {
        id: 'login-retry-diagnosis',
        tasks: [
          {
            id: task!.id,
            version: task!.version,
            prompt: task!.prompt,
            metadata: {
              diagnosis: 'required',
              validation: {
                required: true,
                targetFile: task!.targetFile,
                requiredChecks: ['lint', 'build', 'browser_snapshot'],
                flowPath: task!.flowPath,
                expectedText: task!.expectedText,
              },
            },
          },
        ],
        graders,
      };
      const run = await evaluator.run(suite, {
        concurrency: 1,
        repetitions: 1,
        signal: context.signal,
        limits,
      });
      const trials = await Promise.all(
        run.trialIds.map(async (id) => {
          const trial = await store.loadTrial(id);
          const gradings = (await store.listGradings(id)).filter((record) =>
            run.gradingIds.includes(record.id),
          );
          return { id, status: trial.status, gradings };
        }),
      );
      const failed = trials.some(
        ({ status, gradings }) => status !== 'completed' || gradings.some(gradingFailed),
      );
      const summaries = trials.map(({ id, status, gradings }) => ({
        id,
        status,
        gradings: gradings.map((record) => ({
          id: record.id,
          executionFailed: gradingFailed(record),
          rollups: record.rollups,
          report: path.join(directory, 'gradings', record.id, 'report.md'),
        })),
      }));
      print(
        { ...run, executionFailed: failed, trials: summaries },
        `Saved ${run.id}\n${summaries.map((trial) => `${trial.id}: ${trial.status}; ${trial.gradings.flatMap((grading) => grading.rollups.map((rollup) => `${rollup.grader}=${rollup.verdict}`)).join(', ')}`).join('\n')}\n${failed ? 'Execution or grading needs attention.\n' : ''}Inspect: pnpm evals library show ${run.id}\nRegrade: pnpm evals library regrade ${run.id} --revision 2`,
      );
      return failed ? 2 : 0;
    } else {
      const records = await evaluator.regrade(reference!, { graders, signal: context.signal });
      const summary = records.map((record) => ({
        id: record.id,
        trialId: record.trialId,
        executionFailed: gradingFailed(record),
        rollups: record.rollups,
        report: path.join(directory, 'gradings', record.id, 'report.md'),
        usage: record.requests.map((entry) => entry.response?.usage ?? entry.observedUsage ?? null),
      }));
      print(summary, JSON.stringify(summary, null, 2));
      return records.some(gradingFailed) ? 2 : 0;
    }
  } finally {
    clearInterval(timer);
  }
}
