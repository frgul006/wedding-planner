import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { codeGrader, createEvaluator, modelGrader } from '../../src/index.ts';
import type { CheckResult, Judge, PreparedItem, View } from '../../src/index.ts';
import { item, rubric, setup, trial } from '../fixtures/evaluator.ts';

test('two graders share one prepared view; exact requests precede dispatch and results retain sources', async () => {
  const context = await setup();
  try {
    let preparations = 0;
    let calls = 0;
    const view = {
      id: 'diagnosis',
      version: 1,
      prepare: () => {
        preparations++;
        return [item()];
      },
    } satisfies View;
    const graders = ['prediction', 'probe'].map((id) =>
      modelGrader({ id, version: 1, view, question: id, rubric }),
    );
    const judge: Judge = {
      id: 'fake',
      async prepare(jobs) {
        assert.equal(jobs[0]!.evidence.contentHash, jobs[1]!.evidence.contentHash);
        return [
          {
            id: 'batch-1',
            jobIds: jobs.map((job) => job.id),
            body: { state: jobs[0]!.evidence.data, questions: jobs.map((job) => job.question) },
            metadata: {},
            reservedCostUsd: 0.001,
          },
        ];
      },
      async execute(request) {
        calls++;
        const { readdir } = await import('node:fs/promises');
        const [grading] = await readdir(path.join(context.folder, 'gradings'));
        const saved = JSON.parse(
          await readFile(
            path.join(context.folder, 'gradings', grading!, 'requests/batch-1.json'),
            'utf8',
          ),
        );
        assert.deepEqual(saved.value.body, request.body);
        return {
          answers: request.jobIds.map((jobId) => ({ jobId, verdict: 'pass' })),
          raw: { exactResponse: true },
          model: 'fake-v1',
          usage: { inputTokens: 10, outputTokens: 2, estimatedCostUsd: 0.001 },
        };
      },
    };
    const record = await createEvaluator({ store: context.store, judge }).grade('trial-example', {
      graders,
    });
    assert.equal(preparations, 1);
    assert.equal(calls, 1);
    assert.equal(record.evidence.length, 1);
    assert.equal(record.grades.length, 2);
    assert.deepEqual(record.grades[0]!.consideredRefs, ['e1']);
    assert.equal(record.grades[0]!.supportingRefs, undefined);
    assert.deepEqual(record.requests[0]!.response!.raw, { exactResponse: true });
    const report = await readFile(
      path.join(context.folder, 'gradings', record.id, 'report.md'),
      'utf8',
    );
    assert.equal(report.match(/Exact prepared evidence:/g)?.length, 1);
    assert.equal(report.match(/\]\(#evidence-1\)/g)?.length, 2);
    assert.match(report, /^## Evidence 1$/m);
    assert.ok(report.includes(JSON.stringify(record.evidence[0], null, 2)));
    assert.ok(report.includes(JSON.stringify(record.requests[0].request.body, null, 2)));
    assert.ok(report.includes(JSON.stringify(record.requests[0].response!.raw, null, 2)));
  } finally {
    await context.dispose();
  }
});

test('code grader infers data from view, regrading changes the question/view without rerunning or mutating trial', async () => {
  const context = await setup();
  try {
    let runs = 0;
    const view = { id: 'validation', version: 1, prepare: () => [item()] } satisfies View;
    const first = codeGrader({
      id: 'validation',
      version: 1,
      view,
      check: (evidence) => ({
        verdict: evidence.data.prediction.includes('retry') ? 'pass' : 'fail',
      }),
    });
    const evaluator = createEvaluator({
      store: context.store,
      runner: {
        async run(_task, options) {
          runs++;
          return trial(options.trialId);
        },
      },
    });
    const run = await evaluator.run({ id: 'suite', tasks: [trial().task], graders: [first] });
    const original = await readFile(
      path.join(context.folder, 'trials', `${run.trialIds[0]}.json`),
      'utf8',
    );
    const revised = codeGrader({
      id: 'validation',
      version: 2,
      view: {
        ...view,
        version: 2,
        prepare: () => [{ ...item(), data: { prediction: 'No test observed' } }],
      } satisfies View,
      check: () => ({ verdict: 'fail' }),
    });
    const [regrade] = await evaluator.regrade(run.id, { graders: [revised] });
    assert.equal(runs, 1);
    assert.equal(regrade!.grades[0]!.verdict, 'fail');
    assert.equal(
      await readFile(path.join(context.folder, 'trials', `${run.trialIds[0]}.json`), 'utf8'),
      original,
    );
    const history = await context.store.listGradings(run.trialIds[0]!);
    assert.equal(history.length, 2);
    assert.deepEqual(
      new Set(history.map((record) => record.grades[0]!.verdict)),
      new Set(['pass', 'fail']),
    );
  } finally {
    await context.dispose();
  }
});

test('complete omission fails, incomplete recording stays unknown, and empty views cannot pass', async () => {
  const context = await setup();
  try {
    let checks = 0;
    const make = (id: string, items: PreparedItem[]) =>
      codeGrader({
        id,
        version: 1,
        view: { id, version: 1, prepare: () => items } satisfies View,
        check: () => {
          checks++;
          return { verdict: 'fail' };
        },
      });
    const result = await createEvaluator({ store: context.store }).grade('trial-example', {
      graders: [
        make('omission', [{ ...item(), data: { observedTests: [] } }]),
        make('gap', [{ ...item(), coverage: { complete: false, gaps: ['Tool result missing'] } }]),
        make('empty', []),
        make('docs', [{ ...item(), applicability: 'not_applicable' }]),
      ],
    });
    assert.deepEqual(
      result.grades.map((grade) => grade.verdict),
      ['fail', 'unknown', 'unknown', 'not_applicable'],
    );
    assert.equal(result.grades[2]!.status, 'preparation_error');
    assert.equal(checks, 1);
  } finally {
    await context.dispose();
  }
});

test('different versions of a view retain distinct evidence identities and exact report inputs', async () => {
  const context = await setup();
  try {
    const graders = [1, 2].map((version) =>
      codeGrader({
        id: `validation-v${version}`,
        version: 1,
        view: {
          id: 'validation',
          version,
          prepare: () => [{ ...item(), data: { prediction: `Version ${version} observation` } }],
        } satisfies View,
        check: () => ({ verdict: 'pass' }),
      }),
    );
    const record = await createEvaluator({ store: context.store }).grade('trial-example', {
      graders,
    });
    assert.equal(record.evidence.length, 2);
    assert.notEqual(record.evidence[0].id, record.evidence[1].id);
    for (const [index, grade] of record.grades.entries()) {
      const evidence = record.evidence.find(({ id }) => id === grade.evidenceId);
      assert.equal(evidence?.view.version, index + 1);
      assert.deepEqual(evidence?.data, { prediction: `Version ${index + 1} observation` });
    }
    const report = await readFile(
      path.join(context.folder, 'gradings', record.id, 'report.md'),
      'utf8',
    );
    const sections = report.split('## Evidence ');
    assert.match(sections[1], /Version 1 observation/);
    assert.doesNotMatch(sections[1], /Version 2 observation/);
    assert.match(sections[2], /Version 2 observation/);
    assert.doesNotMatch(sections[2], /Version 1 observation/);
    for (const [index, grade] of record.grades.entries()) {
      assert.ok(report.includes(`Evidence: [${grade.evidenceId}](#evidence-${index + 1})`));
    }
  } finally {
    await context.dispose();
  }
});

test('later graders cannot mutate an earlier result through shared return objects', async () => {
  const context = await setup();
  try {
    const shared: CheckResult = {
      verdict: 'pass',
      reason: 'Original result',
      supportingRefs: ['e1'],
    };
    const view = { id: 'validation', version: 1, prepare: () => [item()] } satisfies View;
    const record = await createEvaluator({ store: context.store }).grade('trial-example', {
      graders: [
        codeGrader({ id: 'first', version: 1, view, check: () => shared }),
        codeGrader({
          id: 'second',
          version: 1,
          view,
          check: () => {
            shared.verdict = 'fail';
            shared.reason = 'Mutated result';
            shared.supportingRefs!.push('not-recorded');
            return { verdict: 'pass' };
          },
        }),
      ],
    });
    assert.equal(record.grades[0].verdict, 'pass');
    assert.equal(record.grades[0].reason, 'Original result');
    assert.deepEqual(record.grades[0].supportingRefs, ['e1']);
    assert.equal((await context.store.listGradings('trial-example')).length, 1);
  } finally {
    await context.dispose();
  }
});
