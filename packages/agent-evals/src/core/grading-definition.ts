import type {
  CodeGrader,
  Grade,
  Grader,
  GradingRecord,
  ModelGrader,
  Verdict,
  View,
} from './types.ts';
import { canonicalJson, immutableCopy } from './serialization.ts';

export const codeGrader = <T>(definition: Omit<CodeGrader<T>, 'kind'>): CodeGrader<T> => ({
  id: definition.id,
  version: definition.version,
  view: definition.view,
  kind: 'code',
  check: definition.check.bind(definition),
});

export const modelGrader = <T>(definition: Omit<ModelGrader<T>, 'kind'>): ModelGrader<T> => ({
  ...definition,
  kind: 'model',
});

export const gradingVerdicts: readonly Verdict[] = ['pass', 'fail', 'unknown', 'not_applicable'];

/** Episodes are counted within each trial; they are never treated as independent trials. */
export function rollupGrades(grades: readonly Grade[]): GradingRecord['rollups'] {
  return [...new Set(grades.map((grade) => grade.grader.id))].map((grader) => {
    const selected = grades.filter((grade) => grade.grader.id === grader);
    const counts = Object.fromEntries(
      gradingVerdicts.map((verdict) => [
        verdict,
        selected.filter((grade) => grade.verdict === verdict).length,
      ]),
    ) as Record<Verdict, number>;

    let verdict: Verdict;
    if (counts.fail) {
      verdict = 'fail';
    } else if (counts.unknown) {
      verdict = 'unknown';
    } else if (counts.pass) {
      verdict = 'pass';
    } else {
      verdict = 'not_applicable';
    }

    return {
      grader,
      verdict,
      counts,
      rule: 'Any fail → fail; otherwise any unknown → unknown; otherwise any pass → pass; otherwise not applicable. Items belong to one trial.',
    };
  });
}

function validateGraders(graders: readonly Grader[]) {
  const ids = new Set<string>();
  const views = new Map<string, View>();

  for (const grader of graders) {
    if (!grader.id || ids.has(grader.id)) {
      throw new Error('Grader IDs must be nonempty and unique');
    }

    ids.add(grader.id);
    const key = canonicalJson([grader.view.id, grader.view.version]);
    if (!grader.view.id || (views.has(key) && views.get(key) !== grader.view)) {
      throw new Error('A view identity/version must refer to one shared view object');
    }
    views.set(key, grader.view);

    if (
      grader.kind === 'model' &&
      (!grader.question.trim() ||
        ['pass', 'fail', 'unknown'].some((key) => !grader.rubric[key as 'pass']?.trim()))
    ) {
      throw new Error('Model graders require a question and pass/fail/unknown criteria');
    }
  }
}

/** Capture a grading definition before asynchronous work can change its declared identity. */
export function snapshotGraders(graders: readonly Grader[]): Grader[] {
  validateGraders(graders);
  const views = new Map<View, View>();

  return graders.map((grader) => {
    let view = views.get(grader.view);
    if (!view) {
      view = Object.freeze({
        id: grader.view.id,
        version: grader.view.version,
        prepare: grader.view.prepare.bind(grader.view),
      });
      views.set(grader.view, view);
    }

    const identity = { id: grader.id, version: grader.version, view };

    return grader.kind === 'code'
      ? Object.freeze({ ...identity, kind: 'code' as const, check: grader.check.bind(grader) })
      : Object.freeze({
          ...identity,
          kind: 'model' as const,
          question: grader.question,
          rubric: immutableCopy(grader.rubric),
        });
  });
}
