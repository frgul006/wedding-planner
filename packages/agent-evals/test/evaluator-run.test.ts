import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { codeGrader, createEvaluator, modelGrader } from '../src/index.ts';
import type { Judge, View } from '../src/index.ts';
import { item, rubric, setup, trial } from './fixtures/evaluator.ts';

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
