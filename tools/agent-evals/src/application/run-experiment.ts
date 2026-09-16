import { EstimatedBudget } from '../domain/budget.ts';

export interface ExperimentStep {
  index: number;
  pair: number;
  variant: 'enabled' | 'disabled';
}
export interface ExperimentPlan {
  steps: ExperimentStep[];
  budget: { limitUsd: number; reservedEstimateUsd: number; perTrialReservationUsd: number };
}
export function planExperiment(
  pairs: number,
  perTrialReservationUsd: number,
  limitUsd: number,
): ExperimentPlan {
  if (!Number.isInteger(pairs) || pairs < 1 || pairs > 10)
    throw new Error('An experiment requires between 1 and 10 pairs.');
  const budget = new EstimatedBudget(limitUsd);
  const steps: ExperimentStep[] = [];
  for (let pair = 1; pair <= pairs; pair++) {
    const order =
      pair % 2 ? (['enabled', 'disabled'] as const) : (['disabled', 'enabled'] as const);
    for (const variant of order) {
      budget.reserve(perTrialReservationUsd);
      steps.push({ index: steps.length + 1, pair, variant });
    }
  }
  return {
    steps,
    budget: { limitUsd, reservedEstimateUsd: budget.reservedUsd, perTrialReservationUsd },
  };
}

export type ExperimentAttempt<T> =
  | { step: ExperimentStep; status: 'recorded'; result: T }
  | { step: ExperimentStep; status: 'dispatch_error'; error: string }
  | { step: ExperimentStep; status: 'not_run' };

/** Failed judgments are observations. Only cancellation prevents a scheduled attempt. */
export async function runExperiment<T>(
  plan: ExperimentPlan,
  execute: (step: ExperimentStep) => Promise<T>,
  save: (attempts: readonly ExperimentAttempt<T>[]) => Promise<void>,
  signal?: AbortSignal,
): Promise<ExperimentAttempt<T>[]> {
  const attempts: ExperimentAttempt<T>[] = plan.steps.map((step) => ({ step, status: 'not_run' }));
  await save(attempts);
  for (const step of plan.steps) {
    if (signal?.aborted) break;
    try {
      attempts[step.index - 1] = { step, status: 'recorded', result: await execute(step) };
    } catch (error) {
      attempts[step.index - 1] = {
        step,
        status: 'dispatch_error',
        error: error instanceof Error ? error.message : 'Trial dispatch failed',
      };
    }
    await save(attempts);
  }
  return attempts;
}
