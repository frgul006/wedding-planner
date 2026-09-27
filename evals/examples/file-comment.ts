import {
  codeGrader,
  type EvaluationTask,
  type PreparedItem,
  type RecordedTrial,
  type TraceArtifact,
} from 'agent-evals';
import { fixtureContent, fixturePath, requestedComment } from './fixture.ts';

export const fileCommentTask: EvaluationTask = {
  id: 'add-file-comment',
  version: 1,
  prompt: `Add exactly ${JSON.stringify(requestedComment.trimEnd())} as the first line of ${fixturePath}. Keep all existing content byte-for-byte unchanged.`,
  limits: { runtimeMs: 120_000, maxTurns: 8, maxTokens: 40_000 },
};

interface FileContentEvidence {
  before?: TraceArtifact;
  final?: TraceArtifact;
}

export const fileContentView = {
  id: 'file-content',
  version: 1,
  prepare(trial: RecordedTrial): PreparedItem<FileContentEvidence>[] {
    const finalIds = Array.isArray(trial.outcome.artifacts) ? trial.outcome.artifacts : [];
    const final = trial.trace.artifacts.find(
      (artifact) => artifact.path === fixturePath && finalIds.includes(artifact.id),
    );
    const before = trial.trace.artifacts.find(
      (artifact) => artifact.path === fixturePath && artifact.id.startsWith('before-'),
    );
    const gaps = [
      ...(before ? [] : ['Starting file artifact is missing.']),
      ...(final ? [] : ['Final file artifact is missing.']),
    ];
    return [
      {
        id: fixturePath,
        data: { before, final },
        scope: `Recorded starting and final content of ${fixturePath}`,
        sourceRefs: [before?.id, final?.id].filter((id): id is string => id !== undefined),
        coverage: { complete: gaps.length === 0, gaps },
        omissions: ['Other files, agent messages, and tool logs are omitted.'],
        applicability: trial.task.id === fileCommentTask.id ? 'applicable' : 'not_applicable',
      },
    ];
  },
};

export const exactFileComment = codeGrader({
  id: 'exact-file-comment',
  version: 1,
  view: fileContentView,
  check(item) {
    if (item.applicability === 'not_applicable') {
      return { verdict: 'not_applicable' };
    }
    if (!item.coverage.complete || !item.data.before || !item.data.final) {
      return { verdict: 'unknown', reason: item.coverage.gaps.join(' ') };
    }
    if (item.data.before.content !== fixtureContent) {
      return {
        verdict: 'unknown',
        reason: 'The recorded starting fixture differs from this example.',
      };
    }
    const pass = item.data.final.content === requestedComment + item.data.before.content;
    return {
      verdict: pass ? 'pass' : 'fail',
      reason: pass
        ? 'The exact comment was added at the top and all original bytes remain unchanged.'
        : 'The final file differs from the exact requested content.',
      supportingRefs: [item.data.before.id, item.data.final.id],
    };
  },
});
