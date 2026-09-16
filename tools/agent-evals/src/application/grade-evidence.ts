import type { Grade, Grader, GradingResult, TrialEvidence } from '../domain/types.ts';

/** The same operation judges a fresh trial and an immutable saved recording. */
export async function gradeEvidence(
  evidence: TrialEvidence,
  graders: readonly Grader[],
  signal?: AbortSignal,
): Promise<GradingResult[]> {
  const results: GradingResult[] = [];
  for (const grader of graders) {
    let entered = false;
    try {
      signal?.throwIfAborted();
      entered = true;
      const result = await grader.grade(evidence, signal);
      if (result.grader !== grader.id || result.version !== grader.version)
        throw new Error('Grader returned an inconsistent identity');
      results.push({
        ...result,
        metering: grader.metering ?? result.metering,
        criteria: result.criteria ?? grader.criteria,
      });
    } catch {
      // Adapter exceptions can contain credentials. Persist a stable failure,
      // keep earlier judgments, and let other independent graders continue.
      const cancelled = signal?.aborted === true;
      results.push({
        grader: grader.id,
        version: grader.version,
        metering: grader.metering,
        criteria: grader.criteria,
        status: cancelled ? 'cancelled' : 'grader_error',
        // Only this path proves no adapter (and therefore no API) was entered.
        // Once entered, a missing response must retain unknown spend.
        ...(!entered && grader.metering !== 'none'
          ? {
              usage: {
                inputTokens: 0,
                outputTokens: 0,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                estimatedCostUsd: 0,
                costSource: 'No API request dispatched: cancelled before grader execution',
              },
            }
          : {}),
        grades: [
          {
            grader: grader.id,
            version: grader.version,
            verdict: 'unknown',
            reason: cancelled ? 'Grading cancelled by user' : 'Grader error',
            evidenceRefs: [],
          },
        ],
      });
    }
  }
  return results;
}

export function flattenGrades(results: readonly GradingResult[]): Grade[] {
  return results.flatMap((result) => result.grades);
}
