import type { GradingResult, TrialEvidence } from '../domain/types.ts';
import type { SemanticReport } from '../domain/report.ts';

/** Compatibility view for reports; rich grading results remain the source of truth. */
export function semanticView(results: readonly GradingResult[]): SemanticReport | undefined {
  const result = results.find((item) => item.grader === 'semantic-task-clarity');
  if (!result) return undefined;
  return {
    ...result.metadata,
    status: result.status,
    model:
      typeof result.metadata?.model === 'string'
        ? result.metadata.model
        : typeof result.criteria?.model === 'string'
          ? result.criteria.model
          : 'unknown',
    usage: result.usage ?? { estimatedCostUsd: null },
    grade: result.grades[0],
  };
}

export function gradingCost(results: readonly GradingResult[]): number | null {
  if (
    results.some(
      (result) =>
        !result.usage &&
        (result.metering === 'semantic-api' ||
          (result.metering !== 'none' && result.status !== 'completed')),
    )
  )
    return null;
  const usage = results.flatMap((result) => (result.usage ? [result.usage] : []));
  return usage.some((item) => item.estimatedCostUsd === null)
    ? null
    : usage.reduce((sum, item) => sum + item.estimatedCostUsd!, 0);
}

/** Subscription usage remains visible, but only direct API estimates consume this allowance. */
export function directApiCost(
  trials: readonly { evidence: TrialEvidence; gradingResults: GradingResult[] }[],
  agentBilling: 'subscription' | 'api',
): number | null {
  let total = 0;
  for (const trial of trials) {
    const grader = gradingCost(trial.gradingResults);
    const agent = agentBilling === 'api' ? trial.evidence.agent.usage.estimatedCostUsd : 0;
    if (grader === null || agent === null) return null;
    total += grader + agent;
  }
  return total;
}
