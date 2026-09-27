import type {
  Grader,
  GradingRecord,
  Judge,
  RecordedTrial,
  Runner,
  Store,
  Suite,
  SuiteRun,
  TrialLimits,
} from './types.ts';
import { immutableCopy } from './serialization.ts';
import { resolveTrialLimits } from './trial-limits.ts';
import { snapshotGraders } from './grading-definition.ts';
import { createTrialGrader } from './grade-trial.ts';

const identity = (prefix: string) => `${prefix}-${Date.now()}-${crypto.randomUUID()}`;

export function createEvaluator(options: {
  store: Store;
  runner?: Runner;
  judge?: Judge;
  /** Conservative aggregate allowance for one run/regrade, not a provider spending cap. */
  budgetUsd?: number;
}) {
  const allowance = options.budgetUsd ?? 0.01;
  if (!Number.isFinite(allowance) || allowance < 0) {
    throw new Error('Invalid judge budget');
  }

  const gradeTrial = createTrialGrader(options, allowance);

  return {
    async grade(trialId: string, input: { graders: readonly Grader[]; signal?: AbortSignal }) {
      return gradeTrial(trialId, snapshotGraders(input.graders), { used: 0 }, input.signal);
    },

    async run(
      suite: Suite,
      input: {
        repetitions?: number;
        signal?: AbortSignal;
        limits?: Partial<TrialLimits>;
      } = {},
    ) {
      suite = {
        id: suite.id,
        tasks: immutableCopy(suite.tasks),
        graders: snapshotGraders(suite.graders),
      };

      if (!options.runner) {
        throw new Error('A runner is required to create trials');
      }

      const runLimits = input.limits === undefined ? undefined : immutableCopy(input.limits);
      // Validate every task before dispatching any agent. Runner-specific defaults remain
      // the runner's responsibility; only authored overrides cross this boundary.
      resolveTrialLimits(runLimits);
      for (const task of suite.tasks) {
        resolveTrialLimits(task.limits, runLimits);
      }

      const repetitions = input.repetitions ?? 1;
      if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10) {
        throw new Error('Use between 1 and 10 repetitions');
      }

      const run: SuiteRun = {
        id: identity('run'),
        suiteId: suite.id,
        trialIds: [],
        gradingIds: [],
      };
      const budget = { used: 0 };

      try {
        for (let iteration = 0; iteration < repetitions; iteration++) {
          for (const task of suite.tasks) {
            input.signal?.throwIfAborted();
            const trialId = identity('trial');
            let trial: RecordedTrial;

            try {
              trial = await options.runner.run(task, {
                trialId,
                signal: input.signal,
                ...(task.limits || runLimits ? { limits: { ...task.limits, ...runLimits } } : {}),
              });
            } catch {
              trial = {
                id: trialId,
                task,
                status: input.signal?.aborted ? 'cancelled' : 'infrastructure_error',
                trace: {
                  events: [],
                  artifacts: [],
                  contexts: [],
                  complete: false,
                  gaps: [
                    'Runner failed before returning a recording; no complete trial evidence is available.',
                  ],
                },
                outcome: {},
                metadata: {
                  runnerFailure:
                    'Runner preparation or execution failed; raw exception details were not persisted.',
                },
              };
            }

            if (trial.id !== trialId) {
              throw new Error('Runner returned an inconsistent trial ID');
            }

            await options.store.saveTrial(trial);
            run.trialIds.push(trial.id);

            const grading = await gradeTrial(trial.id, suite.graders, budget, input.signal);
            run.gradingIds.push(grading.id);
          }
        }
      } finally {
        await options.store.saveRun(run);
      }

      return run;
    },

    async regrade(runId: string, input: { graders: readonly Grader[]; signal?: AbortSignal }) {
      const graders = snapshotGraders(input.graders);
      const run = await options.store.loadRun(runId);
      const budget = { used: 0 };
      const records: GradingRecord[] = [];

      for (const trialId of run.trialIds) {
        records.push(await gradeTrial(trialId, graders, budget, input.signal));
      }

      return records;
    },
  };
}
