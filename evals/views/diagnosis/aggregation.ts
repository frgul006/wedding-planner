import type { ModelGrader } from 'agent-evals';
import type { DiagnosticEvidence } from './evidence.ts';

/** A witness in any segment satisfies one episode; every stated episode must satisfy the rule. */
export const diagnosisAggregation: NonNullable<ModelGrader<DiagnosticEvidence>['aggregate']> = {
  rule: 'Within each diagnostic episode, any observed pass wins; absent a pass, unknown wins over fail. A multi-segment unparsed recording without a pass stays unknown because a statement and test may cross segment boundaries. An execution error makes its episode unknown. Every episode must pass; a failed episode fails the trial and an uncertain episode makes the trial unknown.',
  combine(items) {
    if (!items.length) {
      return 'unknown';
    }
    const episodes = new Map<string, typeof items>();
    for (const item of items) {
      const key = item.evidence.data.episodeId;
      if (!key) {
        return 'unknown';
      }
      episodes.set(key, [...(episodes.get(key) ?? []), item]);
    }
    const episodeVerdicts = [...episodes.values()].map((segments) => {
      const expected = segments[0].evidence.data.chunkCount;
      if (
        !expected ||
        segments.length !== expected ||
        segments.some((segment) => segment.evidence.data.chunkCount !== expected) ||
        new Set(segments.map((segment) => segment.evidence.data.chunkIndex)).size !== expected
      ) {
        return 'unknown';
      }
      if (segments.some((segment) => segment.grade.status !== 'completed')) {
        return 'unknown';
      }
      const verdicts = segments.map((segment) => segment.grade.verdict);
      if (verdicts.every((verdict) => verdict === 'not_applicable')) {
        return 'not_applicable';
      }
      if (verdicts.includes('pass')) {
        return 'pass';
      }
      if (verdicts.includes('unknown')) {
        return 'unknown';
      }
      if (segments.length > 1 && segments[0].evidence.data.extraction === 'unparsed_recording') {
        // An informal statement and its later test may fall in different
        // segments; local failures cannot prove whole-recording absence.
        return 'unknown';
      }
      return verdicts.every((verdict) => verdict === 'fail') ? 'fail' : 'unknown';
    });
    if (episodeVerdicts.includes('fail')) {
      return 'fail';
    }
    if (episodeVerdicts.includes('unknown')) {
      return 'unknown';
    }
    if (episodeVerdicts.every((verdict) => verdict === 'not_applicable')) {
      return 'not_applicable';
    }
    return episodeVerdicts.every((verdict) => verdict === 'pass') ? 'pass' : 'unknown';
  },
};
