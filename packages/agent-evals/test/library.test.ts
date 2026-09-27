import type { View } from '../src/index.ts';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { codeGrader, createEvaluator, modelGrader, JudgeExecutionError } from '../src/index.ts';
import type { CheckResult, Judge, PreparedItem, RecordedTrial } from '../src/index.ts';
import { fileStore } from '../src/adapters/files.ts';
import { canonicalJson, contentHash } from '../src/core/serialization.ts';

const trial = (id = 'trial-example'): RecordedTrial => ({
  id,
  task: { id: 'bug', version: 1, prompt: 'Repair retry behavior' },
  status: 'completed',
  trace: {
    events: [
      {
        id: 'e1',
        sequence: 1,
        timestamp: '2026-09-27',
        actor: 'agent',
        type: 'message',
        data: {
          role: 'assistant',
          text: 'If the error disables the button, clearing it enables retry.',
        },
      },
    ],
    artifacts: [],
    contexts: [],
    complete: true,
    gaps: [],
  },
  outcome: {},
  metadata: {},
});
const item = (id = 'episode'): PreparedItem<{ prediction: string }> => ({
  id,
  data: { prediction: 'Clearing the error enables retry' },
  scope: 'One diagnostic episode',
  sourceRefs: ['e1'],
  coverage: { complete: true, gaps: [] },
  omissions: [],
  applicability: 'applicable',
});
const rubric = {
  pass: 'Observable disproof exists',
  fail: 'No observable disproof',
  unknown: 'Insufficient evidence',
};

async function setup() {
  const folder = await mkdtemp(path.join(tmpdir(), 'eval-library-'));
  const store = fileStore(folder);
  await store.saveTrial(trial());
  return { folder, store, dispose: () => rm(folder, { recursive: true, force: true }) };
}

test('suite budgets are per trial and run overrides preserve task fields across repetitions', async () => {
  const context = await setup();
  const seen: unknown[] = [];
  const evaluator = createEvaluator({
    store: context.store,
    runner: {
      async run(task, request) {
        seen.push(request.limits);
        return { ...trial(request.trialId), task };
      },
    },
  });
  try {
    const tasks = [
      { id: 'small', version: 1, prompt: 'Small task', limits: { runtimeMs: 1000, maxTurns: 10 } },
      {
        id: 'large',
        version: 1,
        prompt: 'Large task',
        limits: { runtimeMs: 7_200_000, maxTurns: 1000 },
      },
    ];
    const run = await evaluator.run(
      { id: 'budgets', tasks, graders: [] },
      { repetitions: 2, limits: { maxTokens: 9_000_000, maxTurns: 700 } },
    );
    assert.equal(run.trialIds.length, 4);
    assert.deepEqual(seen, [
      { runtimeMs: 1000, maxTurns: 700, maxTokens: 9_000_000 },
      { runtimeMs: 7_200_000, maxTurns: 700, maxTokens: 9_000_000 },
      { runtimeMs: 1000, maxTurns: 700, maxTokens: 9_000_000 },
      { runtimeMs: 7_200_000, maxTurns: 700, maxTokens: 9_000_000 },
    ]);
    await assert.rejects(
      evaluator.run({
        id: 'invalid',
        tasks: [...tasks, { ...tasks[0]!, limits: { maxTurns: 0 } }],
        graders: [],
      }),
      /positive safe integer/,
    );
    assert.equal(seen.length, 4, 'all configurations validated before the first dispatch');
  } finally {
    await context.dispose();
  }
});

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

test('aggregate admission rejects all batches before any request is dispatched', async () => {
  const context = await setup();
  try {
    let calls = 0;
    const view = { id: 'view', version: 1, prepare: () => [item('a'), item('b')] } satisfies View;
    const judge: Judge = {
      id: 'fake',
      async prepare(jobs) {
        return jobs.map((job, index) => ({
          id: `b${index}`,
          jobIds: [job.id],
          body: {},
          metadata: {},
          reservedCostUsd: 0.006,
        }));
      },
      async execute() {
        calls++;
        throw new Error('Must not execute');
      },
    };
    const record = await createEvaluator({ store: context.store, judge, budgetUsd: 0.01 }).grade(
      'trial-example',
      {
        graders: [modelGrader({ id: 'check', version: 1, view, question: 'Prediction?', rubric })],
      },
    );
    assert.equal(calls, 0);
    assert.equal(record.requests.length, 2);
    assert.ok(
      record.grades.every((grade) => grade.verdict === 'unknown' && /budget/.test(grade.reason!)),
    );
  } finally {
    await context.dispose();
  }
});

test('malformed provider answers, unresolved refs and mutation attempts become retained errors', async () => {
  const context = await setup();
  try {
    const view = { id: 'good', version: 1, prepare: () => [item()] } satisfies View;
    const judge: Judge = {
      id: 'bad',
      async prepare(jobs) {
        return [
          {
            id: 'batch',
            jobIds: jobs.map((job) => job.id),
            body: {},
            metadata: {},
            reservedCostUsd: 0,
          },
        ];
      },
      async execute() {
        return {
          answers: [],
          raw: {},
          model: 'fake',
          usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
        };
      },
    };
    const result = await createEvaluator({ store: context.store, judge }).grade('trial-example', {
      graders: [
        modelGrader({ id: 'model', version: 1, view, question: 'Prediction?', rubric }),
        codeGrader({
          id: 'bad-ref',
          version: 1,
          view: {
            id: 'bad-ref',
            version: 1,
            prepare: () => [{ ...item(), sourceRefs: ['not-recorded'] }],
          } satisfies View,
          check: () => ({ verdict: 'pass' }),
        }),
        codeGrader({
          id: 'mutator',
          version: 1,
          view,
          check: (evidence) => {
            evidence.data.prediction = 'Changed';
            return { verdict: 'pass' };
          },
        }),
      ],
    });
    assert.ok(result.grades.every((grade) => grade.verdict === 'unknown'));
    assert.equal(
      (await context.store.loadTrial('trial-example')).trace.events[0]!.data.text,
      trial().trace.events[0]!.data.text,
    );
  } finally {
    await context.dispose();
  }
});

test('file store refuses overwrite/path traversal and detects modified records', async () => {
  const context = await setup();
  try {
    await assert.rejects(context.store.saveTrial(trial()), /EEXIST/);
    await assert.rejects(context.store.loadTrial('../outside'), /Invalid saved record/);
    const file = path.join(context.folder, 'trials/trial-example.json');
    const original = JSON.parse(await readFile(file, 'utf8'));
    original.value.status = 'modified';
    await writeFile(file, JSON.stringify(original));
    await assert.rejects(context.store.loadTrial('trial-example'), /integrity/);
  } finally {
    await context.dispose();
  }
});

test('canonical identity ignores object insertion order but rejects lossy evidence', async () => {
  assert.equal(await contentHash({ a: 1, b: 2 }), await contentHash({ b: 2, a: 1 }));
  assert.notEqual(await contentHash({ data: 'one' }), await contentHash({ data: 'two' }));
  assert.throws(() => canonicalJson({ count: NaN }), /JSON values/);
  assert.throws(() => canonicalJson(new Date()), /plain JSON/);
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
    for (const [index, grade] of record.grades.entries())
      assert.ok(report.includes(`Evidence: [${grade.evidenceId}](#evidence-${index + 1})`));
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

for (const failure of [
  'missing-raw',
  'missing-answers',
  'nan-usage',
  'non-json-metadata',
] as const) {
  test(`invalid generic judge ${failure} retains an error grading record`, async () => {
    const context = await setup();
    try {
      const view = { id: 'validation', version: 1, prepare: () => [item()] } satisfies View;
      const judge: Judge = {
        id: 'malformed',
        async prepare(jobs) {
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
        async execute(request) {
          return {
            answers:
              failure === 'missing-answers'
                ? undefined!
                : request.jobIds.map((jobId) => ({
                    jobId,
                    verdict: 'pass' as const,
                    ...(failure === 'non-json-metadata'
                      ? { metadata: { created: new Date() } }
                      : {}),
                  })),
            raw: failure === 'missing-raw' ? undefined : {},
            model: 'malformed-v1',
            usage: {
              inputTokens: failure === 'nan-usage' ? NaN : 1,
              outputTokens: 0,
              estimatedCostUsd: 0,
            },
          };
        },
      };
      const record = await createEvaluator({ store: context.store, judge }).grade('trial-example', {
        graders: [modelGrader({ id: 'check', version: 1, view, question: 'Prediction?', rubric })],
      });
      assert.equal(record.grades.length, 1);
      assert.equal(record.grades[0].verdict, 'unknown');
      assert.equal(record.grades[0].status, 'grader_error');
      assert.equal(record.requests[0].response, undefined);
      if (failure === 'missing-answers') {
        assert.ok(record.requests[0].receivedResponse);
        assert.equal(record.requests[0].observedUsage?.inputTokens, 1);
      }
      assert.equal(
        record.requests[0].error,
        failure === 'missing-answers' || failure === 'missing-raw'
          ? 'Invalid judge response membership'
          : 'Judge request failed; no safe provider response was available',
      );
      assert.equal((await context.store.listGradings('trial-example')).length, 1);
    } finally {
      await context.dispose();
    }
  });
}

test('ordinary judge errors stay generic even when their name impersonates a safe error', async () => {
  const context = await setup();
  try {
    const privateMessage = 'Private judge failure contains a synthetic credential';
    const judge: Judge = {
      id: 'untrusted-errors',
      async prepare(jobs) {
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
        const error = new Error(privateMessage);
        error.name = 'JudgeExecutionError';
        throw error;
      },
    };
    const view = { id: 'validation', version: 1, prepare: () => [item()] } satisfies View;
    const record = await createEvaluator({ store: context.store, judge }).grade('trial-example', {
      graders: [modelGrader({ id: 'check', version: 1, view, question: 'Prediction?', rubric })],
    });
    assert.equal(
      record.requests[0].error,
      'Judge request failed; no safe provider response was available',
    );
    assert.equal(record.grades[0].status, 'grader_error');
    assert.ok(!JSON.stringify(record).includes(privateMessage));
    assert.ok(
      !JSON.stringify(await context.store.listGradings('trial-example')).includes(privateMessage),
    );
  } finally {
    await context.dispose();
  }
});

test('request recording failure prevents dispatch and is explicit in retained inspection records', async () => {
  const context = await setup();
  try {
    let calls = 0;
    const store = {
      ...context.store,
      async saveRequest() {
        throw new Error('Private storage details');
      },
    };
    const judge: Judge = {
      id: 'fake',
      async prepare(jobs) {
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
        calls++;
        throw new Error('Must not dispatch');
      },
    };
    const view = { id: 'validation', version: 1, prepare: () => [item()] } satisfies View;
    const record = await createEvaluator({ store, judge }).grade('trial-example', {
      graders: [modelGrader({ id: 'check', version: 1, view, question: 'Prediction?', rubric })],
    });
    assert.equal(calls, 0);
    assert.equal(record.requests[0].dispatched, false);
    assert.match(record.requests[0].error!, /not dispatched/);
    assert.equal(record.grades[0].status, 'grader_error');
    assert.equal((await context.store.listGradings('trial-example')).length, 1);
    assert.doesNotMatch(JSON.stringify(record), /Private storage details/);
  } finally {
    await context.dispose();
  }
});

for (const adapterRejects of [false, true]) {
  test(`malformed paid response retains exact received data and usage (adapter rejects: ${adapterRejects})`, async () => {
    const context = await setup();
    try {
      const received = {
        model: 'fake-v1',
        answers: [],
        raw: { incomplete: true },
        usage: { inputTokens: 17, outputTokens: 3, estimatedCostUsd: 0.0001 },
      };
      const judge: Judge = {
        id: 'fake',
        async prepare(jobs) {
          return [
            {
              id: 'batch',
              jobIds: jobs.map((job) => job.id),
              body: {},
              metadata: {},
              reservedCostUsd: 0.001,
            },
          ];
        },
        async execute() {
          if (adapterRejects)
            throw new JudgeExecutionError('Invalid answers', received, received.usage);
          return received;
        },
      };
      const view = { id: 'diagnosis', version: 1, prepare: () => [item()] } satisfies View;
      const result = await createEvaluator({ store: context.store, judge }).grade('trial-example', {
        graders: [
          modelGrader({ id: 'hypothesis', version: 1, view, question: 'Prediction?', rubric }),
        ],
      });
      assert.equal(result.requests[0].response, undefined);
      assert.deepEqual(result.requests[0].receivedResponse, received);
      assert.deepEqual(result.requests[0].observedUsage, received.usage);
      assert.equal(result.grades[0].status, 'grader_error');
      assert.equal(result.grades[0].verdict, 'unknown');
      const persisted = (await context.store.listGradings('trial-example'))[0];
      assert.deepEqual(persisted.requests[0].receivedResponse, received);
      const report = await readFile(
        path.join(context.folder, 'gradings', result.id, 'report.md'),
        'utf8',
      );
      assert.match(report, /incomplete/);
      assert.match(report, /Observed estimate: \$0\.00010000/);
    } finally {
      await context.dispose();
    }
  });
}

test('runner exceptions retain a failed trial and unknown grading without secret details or a regrade rerun', async () => {
  const context = await setup();
  let runs = 0;
  let checks = 0;
  try {
    const failure = 'Private runner transport request contained sk-private-runner-fixture-secret';
    const view = {
      id: 'recorded-behavior',
      version: 1,
      prepare: (recording) => [
        {
          id: 'attempt',
          data: { eventCount: recording.trace.events.length },
          scope: 'Observable behavior in this attempt',
          sourceRefs: recording.trace.events.map((event) => event.id),
          coverage: { complete: recording.trace.complete, gaps: recording.trace.gaps },
          omissions: [],
          applicability: 'applicable' as const,
        },
      ],
    } satisfies View;
    const grader = codeGrader({
      id: 'behavior',
      version: 1,
      view,
      check: () => {
        checks++;
        return { verdict: 'pass' };
      },
    });
    const evaluator = createEvaluator({
      store: context.store,
      runner: {
        async run() {
          runs++;
          throw new Error(failure);
        },
      },
    });
    const run = await evaluator.run({
      id: 'failed-attempt',
      tasks: [trial().task],
      graders: [grader],
    });
    assert.equal(runs, 1);
    assert.equal(checks, 0);
    assert.equal(run.trialIds.length, 1);
    assert.equal(run.gradingIds.length, 1);
    assert.deepEqual(await context.store.loadRun(run.id), run);
    const failed = await context.store.loadTrial(run.trialIds[0]);
    assert.equal(failed.status, 'infrastructure_error');
    assert.equal(failed.trace.complete, false);
    assert.deepEqual(failed.trace.events, []);
    assert.match(failed.trace.gaps.join(' '), /Runner failed before returning a recording/);
    assert.match(String(failed.metadata.runnerFailure), /raw exception details were not persisted/);
    const file = path.join(context.folder, 'trials', `${failed.id}.json`);
    const original = await readFile(file, 'utf8');
    assert.doesNotMatch(original, /Private runner transport|sk-private-runner-fixture-secret/);
    const [first] = await context.store.listGradings(failed.id);
    assert.equal(first.grades[0].verdict, 'unknown');
    assert.equal(first.rollups[0].verdict, 'unknown');
    const [regraded] = await evaluator.regrade(run.id, { graders: [{ ...grader, version: 2 }] });
    assert.equal(runs, 1);
    assert.equal(checks, 0);
    assert.equal(regraded.grades[0].verdict, 'unknown');
    assert.equal((await context.store.listGradings(failed.id)).length, 2);
    assert.equal(await readFile(file, 'utf8'), original);
    assert.doesNotMatch(
      JSON.stringify([run, failed, first, regraded]),
      /Private runner transport|sk-private-runner-fixture-secret/,
    );
  } finally {
    await context.dispose();
  }
});

test('run and regrade share one conservative judge allowance across repeated trials', async () => {
  const context = await setup();
  let runnerCalls = 0;
  let judgeCalls = 0;
  try {
    const view = { id: 'shared-budget', version: 1, prepare: () => [item()] } satisfies View;
    const grader = modelGrader({
      id: 'budgeted',
      version: 1,
      view,
      question: 'Does it predict?',
      rubric,
    });
    const judge: Judge = {
      id: 'budget-fixture',
      async prepare(jobs) {
        return [
          {
            id: 'batch',
            jobIds: jobs.map((job) => job.id),
            body: {},
            metadata: {},
            reservedCostUsd: 0.006,
          },
        ];
      },
      async execute(request) {
        judgeCalls++;
        return {
          answers: request.jobIds.map((jobId) => ({ jobId, verdict: 'pass' as const })),
          raw: { response: 'observed' },
          model: 'fixture-v1',
          usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0.001 },
        };
      },
    };
    const evaluator = createEvaluator({
      store: context.store,
      judge,
      budgetUsd: 0.01,
      runner: {
        async run(_task, options) {
          runnerCalls++;
          return trial(options.trialId);
        },
      },
    });
    const run = await evaluator.run(
      { id: 'budget-suite', tasks: [trial().task], graders: [grader] },
      { repetitions: 2 },
    );
    assert.equal(runnerCalls, 2);
    assert.equal(judgeCalls, 1);
    assert.equal(run.trialIds.length, 2);
    const [first] = await context.store.listGradings(run.trialIds[0]);
    const [second] = await context.store.listGradings(run.trialIds[1]);
    assert.equal(first.grades[0].verdict, 'pass');
    assert.equal(second.grades[0].verdict, 'unknown');
    assert.equal(second.requests[0].dispatched, false);
    assert.match(second.requests[0].error!, /Aggregate judge budget exceeded/);
    const regraded = await evaluator.regrade(run.id, { graders: [grader] });
    assert.equal(runnerCalls, 2);
    assert.equal(judgeCalls, 2);
    assert.deepEqual(
      regraded.map((record) => record.grades[0].verdict),
      ['pass', 'unknown'],
    );
    assert.equal(regraded[1].requests[0].dispatched, false);
  } finally {
    await context.dispose();
  }
});

test('cancellation after one judge response retains that response and prevents remaining dispatches', async () => {
  const context = await setup();
  const controller = new AbortController();
  let calls = 0;
  try {
    const view = {
      id: 'cancellation',
      version: 1,
      prepare: () => [item('first'), item('second')],
    } satisfies View;
    const judge: Judge = {
      id: 'cancel-fixture',
      async prepare(jobs) {
        return jobs.map((job, index) => ({
          id: `batch-${index}`,
          jobIds: [job.id],
          body: {},
          metadata: {},
          reservedCostUsd: 0.001,
        }));
      },
      async execute(request) {
        calls++;
        controller.abort();
        return {
          answers: request.jobIds.map((jobId) => ({ jobId, verdict: 'pass' as const })),
          raw: { complete: true },
          model: 'fixture-v1',
          usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0.001 },
        };
      },
    };
    const record = await createEvaluator({ store: context.store, judge }).grade('trial-example', {
      graders: [
        modelGrader({ id: 'cancelled-check', version: 1, view, question: 'Prediction?', rubric }),
      ],
      signal: controller.signal,
    });
    assert.equal(calls, 1);
    assert.deepEqual(
      record.requests.map((entry) => entry.dispatched),
      [true, false],
    );
    assert.equal(record.requests[0].response?.usage.estimatedCostUsd, 0.001);
    assert.match(record.requests[1].error!, /Cancelled before dispatch/);
    assert.deepEqual(
      record.grades.map((grade) => [grade.verdict, grade.status]),
      [
        ['pass', 'completed'],
        ['unknown', 'cancelled'],
      ],
    );
    assert.equal((await context.store.listGradings('trial-example')).length, 1);
  } finally {
    await context.dispose();
  }
});
