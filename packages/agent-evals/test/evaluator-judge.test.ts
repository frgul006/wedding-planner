import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { codeGrader, createEvaluator, JudgeExecutionError, modelGrader } from '../src/index.ts';
import type { Judge, View } from '../src/index.ts';
import { item, rubric, setup, trial } from './fixtures/evaluator.ts';

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
          if (adapterRejects) {
            throw new JudgeExecutionError('Invalid answers', received, received.usage);
          }
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
