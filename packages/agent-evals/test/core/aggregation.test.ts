import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { codeGrader, createEvaluator, modelGrader } from '../../src/index.ts';
import type {
  Grade,
  JudgmentJob,
  PreparedEvidence,
  PreparedItem,
  Verdict,
  View,
} from '../../src/index.ts';
import { item, setup } from '../fixtures/evaluator.ts';

type Episode = { hypothesis: string; verdict: Verdict };
type GradedItem = { grade: Grade; evidence: PreparedEvidence };

const chunks = (values: Episode[]): View<Episode> => ({
  id: 'chunks',
  version: 1,
  prepare: () =>
    values.map((value, index): PreparedItem<Episode> => ({
      ...item(`chunk-${index}`),
      data: value,
    })),
});

function allHypotheses(items: readonly GradedItem[]): Verdict {
  const groups = new Map<string, Verdict[]>();
  for (const { grade, evidence } of items) {
    const hypothesis = (evidence.data as Episode).hypothesis;
    groups.set(hypothesis, [...(groups.get(hypothesis) ?? []), grade.verdict]);
  }
  const grouped = [...groups.values()].map((verdicts): Verdict =>
    verdicts.includes('pass')
      ? 'pass'
      : verdicts.includes('unknown')
        ? 'unknown'
        : verdicts.includes('fail')
          ? 'fail'
          : 'not_applicable',
  );
  return grouped.includes('fail')
    ? 'fail'
    : grouped.includes('unknown')
      ? 'unknown'
      : grouped.includes('pass')
        ? 'pass'
        : 'not_applicable';
}

test('consumer aggregation allows a relevant chunk within each hypothesis and persists its rule', async () => {
  const context = await setup();
  try {
    const view = chunks([
      { hypothesis: 'first', verdict: 'fail' },
      { hypothesis: 'first', verdict: 'pass' },
      { hypothesis: 'second', verdict: 'pass' },
    ]);
    const custom = codeGrader<Episode>({
      id: 'custom',
      version: 1,
      view,
      check: ({ data }) => ({ verdict: data.verdict }),
      aggregate: {
        rule: 'Any passing chunk per hypothesis; every hypothesis must pass.',
        combine: allHypotheses,
      },
    });
    const standard = codeGrader<Episode>({
      id: 'standard',
      version: 1,
      view,
      check: ({ data }) => ({ verdict: data.verdict }),
    });
    const result = await createEvaluator({ store: context.store }).grade('trial-example', {
      graders: [custom, standard],
    });
    assert.equal(result.rollups[0].verdict, 'pass');
    assert.equal(result.rollups[1].verdict, 'fail');
    assert.equal(result.rollups[0].rule, custom.aggregate!.rule);
    assert.deepEqual(result.rollups[0].counts, {
      pass: 2,
      fail: 1,
      unknown: 0,
      not_applicable: 0,
    });
    const report = await readFile(
      path.join(context.folder, 'gradings', result.id, 'report.md'),
      'utf8',
    );
    assert.match(report, /Any passing chunk per hypothesis; every hypothesis must pass/);
    assert.match(report, /Any fail → fail; otherwise any unknown/);
  } finally {
    await context.dispose();
  }
});

test('consumer aggregation requires all hypotheses and retains unknown coverage', async () => {
  const context = await setup();
  try {
    for (const [values, expected] of [
      [
        [
          { hypothesis: 'first', verdict: 'pass' },
          { hypothesis: 'second', verdict: 'fail' },
        ],
        'fail',
      ],
      [
        [
          { hypothesis: 'first', verdict: 'pass' },
          { hypothesis: 'second', verdict: 'unknown' },
        ],
        'unknown',
      ],
    ] as const) {
      const result = await createEvaluator({ store: context.store }).grade('trial-example', {
        graders: [
          codeGrader<Episode>({
            id: 'probe',
            version: 1,
            view: chunks([...values]),
            check: ({ data }) => ({ verdict: data.verdict }),
            aggregate: {
              rule: 'Any chunk per hypothesis; all hypotheses.',
              combine: allHypotheses,
            },
          }),
        ],
      });
      assert.equal(result.rollups[0].verdict, expected);
    }
  } finally {
    await context.dispose();
  }
});

test('model grader aggregates judgments paired with their exact evidence', async () => {
  const context = await setup();
  try {
    let prepared: readonly JudgmentJob[] = [];
    const judge = {
      id: 'offline',
      async prepare(jobs: readonly JudgmentJob[]) {
        prepared = jobs;
        return [
          {
            id: 'batch',
            jobIds: jobs.map(({ id }) => id),
            body: {},
            metadata: {},
            reservedCostUsd: 0,
          },
        ];
      },
      async execute() {
        return {
          answers: prepared.map((job) => ({
            jobId: job.id,
            verdict: (job.evidence.data as Episode).verdict,
          })),
          raw: {},
          model: 'offline-v1',
          usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
        };
      },
    };
    const grader = modelGrader<Episode>({
      id: 'semantic',
      version: 1,
      view: chunks([
        { hypothesis: 'first', verdict: 'fail' },
        { hypothesis: 'first', verdict: 'pass' },
        { hypothesis: 'second', verdict: 'pass' },
      ]),
      question: 'Did a tool test the hypothesis?',
      rubric: { pass: 'Yes', fail: 'No', unknown: 'Unclear' },
      aggregate: { rule: 'Any chunk per hypothesis; all hypotheses.', combine: allHypotheses },
    });
    const result = await createEvaluator({ store: context.store, judge }).grade('trial-example', {
      graders: [grader],
    });
    assert.equal(result.jobs.length, 3);
    assert.equal(result.rollups[0].verdict, 'pass');
    assert.deepEqual(result.rollups[0].counts, {
      pass: 2,
      fail: 1,
      unknown: 0,
      not_applicable: 0,
    });
  } finally {
    await context.dispose();
  }
});

test('aggregation snapshots rule, method, and receiver before asynchronous loading', async () => {
  const context = await setup();
  try {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store = {
      ...context.store,
      async loadTrial(id: string) {
        await gate;
        return context.store.loadTrial(id);
      },
    };
    class Aggregate {
      rule = 'Original aggregation rule';
      #expected: Verdict = 'pass';
      combine() {
        return this.#expected;
      }
    }
    const aggregate = new Aggregate();
    const grader = codeGrader({
      id: 'snapshot',
      version: 1,
      view: chunks([{ hypothesis: 'first', verdict: 'fail' }]),
      check: ({ data }) => ({ verdict: data.verdict }),
      aggregate,
    });
    const pending = createEvaluator({ store }).grade('trial-example', { graders: [grader] });
    aggregate.rule = 'Mutated rule';
    aggregate.combine = () => 'fail';
    release();
    const result = await pending;
    assert.equal(result.rollups[0].verdict, 'pass');
    assert.equal(result.rollups[0].rule, 'Original aggregation rule');
  } finally {
    await context.dispose();
  }
});

test('authored aggregation requires a nonempty rule and callable combine', () => {
  const view = chunks([{ hypothesis: 'first', verdict: 'pass' }]);
  assert.throws(
    () =>
      codeGrader({
        id: 'missing-rule',
        version: 1,
        view,
        check: () => ({ verdict: 'pass' }),
        aggregate: { rule: ' ', combine: () => 'pass' },
      }),
    /nonempty rule/,
  );
  assert.throws(
    () =>
      codeGrader({
        id: 'missing-callback',
        version: 1,
        view,
        check: () => ({ verdict: 'pass' }),
        aggregate: { rule: 'Valid rule', combine: null as never },
      }),
    /combine function/,
  );
});

test('aggregation cannot rewrite retained item grades or prepared evidence', async () => {
  const context = await setup();
  try {
    const result = await createEvaluator({ store: context.store }).grade('trial-example', {
      graders: [
        codeGrader<Episode>({
          id: 'mutating',
          version: 1,
          view: chunks([{ hypothesis: 'original', verdict: 'pass' }]),
          check: ({ data }) => ({ verdict: data.verdict }),
          aggregate: {
            rule: 'Pass if observed.',
            combine(items) {
              items[0]!.grade.verdict = 'fail';
              items[0]!.evidence.data.hypothesis = 'altered';
              return 'pass';
            },
          },
        }),
      ],
    });
    assert.equal(result.rollups[0].verdict, 'unknown');
    assert.equal(result.rollups[0].status, 'aggregation_error');
    assert.equal(result.grades[0].verdict, 'pass');
    assert.equal((result.evidence[0].data as Episode).hypothesis, 'original');
  } finally {
    await context.dispose();
  }
});

test('an aggregation exception or invalid verdict is an explicit execution failure', async () => {
  const context = await setup();
  try {
    const view = chunks([{ hypothesis: 'first', verdict: 'pass' }]);
    const result = await createEvaluator({ store: context.store }).grade('trial-example', {
      graders: ['throw', 'invalid'].map((id) =>
        codeGrader({
          id,
          version: 1,
          view,
          check: ({ data }) => ({ verdict: data.verdict }),
          aggregate: {
            rule: `${id} rule`,
            combine: () => {
              if (id === 'throw') {
                throw new Error('secret');
              }
              return 'impossible' as Verdict;
            },
          },
        }),
      ),
    });
    assert.deepEqual(
      result.rollups.map(({ verdict, status, reason }) => ({ verdict, status, reason })),
      [
        {
          verdict: 'unknown',
          status: 'aggregation_error',
          reason: 'Aggregation callback failed or returned an invalid verdict',
        },
        {
          verdict: 'unknown',
          status: 'aggregation_error',
          reason: 'Aggregation callback failed or returned an invalid verdict',
        },
      ],
    );
    const report = await readFile(
      path.join(context.folder, 'gradings', result.id, 'report.md'),
      'utf8',
    );
    assert.match(report, /Aggregation callback failed or returned an invalid verdict/);
    assert.doesNotMatch(report, /secret/);
  } finally {
    await context.dispose();
  }
});
