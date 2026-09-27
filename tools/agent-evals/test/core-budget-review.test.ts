import type { View } from '../src/index.ts';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileStore } from '../src/adapters/library-file-store.ts';
import { JudgeExecutionError } from '../src/application/judge-errors.ts';
import { createEvaluator, modelGrader } from '../src/index.ts';
import type { Judge } from '../src/index.ts';

function grader(items: number) {
  return modelGrader({
    id: 'budget-review',
    version: 1,
    view: {
      id: 'budget-review',
      version: 1,
      prepare: () =>
        Array.from({ length: items }, (_, index) => ({
          id: `item-${index}`,
          data: { observation: index },
          scope: 'Authored fixture',
          sourceRefs: [],
          coverage: { complete: true, gaps: [] },
          omissions: [],
          applicability: 'applicable' as const,
        })),
    } satisfies View,
    question: 'Does the evidence support the stated observation?',
    rubric: {
      pass: 'Observation supported',
      fail: 'Observation contradicted',
      unknown: 'Evidence incomplete',
    },
  });
}
async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), 'eval-budget-review-'));
  const store = fileStore(directory);
  await store.saveTrial({
    id: 'trial',
    task: { id: 'authored', version: 1, prompt: 'Authored fixture' },
    status: 'completed',
    trace: { events: [], artifacts: [], contexts: [], complete: true, gaps: [] },
    outcome: {},
    metadata: {},
  });
  return { directory, store };
}

for (const responseKind of ['valid', 'invalid', 'non-JSON'] as const) {
  test(`observed cost above reservation prevents subsequent dispatch after ${responseKind} answers`, async (context) => {
    const { directory, store } = await setup();
    context.after(() => rm(directory, { recursive: true, force: true }));
    let calls = 0;
    const usage = { inputTokens: 100, outputTokens: 0, estimatedCostUsd: 0.02 };
    const judge: Judge = {
      id: 'underestimated-judge',
      async prepare(jobs) {
        return jobs.map(({ id }, index) => ({
          id: `batch-${index}`,
          jobIds: [id],
          body: {},
          metadata: {},
          reservedCostUsd: 0.001,
        }));
      },
      async execute(request) {
        calls++;
        if (responseKind !== 'valid')
          throw new JudgeExecutionError(
            'Invalid authored response',
            responseKind === 'non-JSON' ? { unserializable: 1n } : { answers: {} },
            usage,
          );
        return {
          answers: request.jobIds.map((jobId) => ({ jobId, verdict: 'pass' as const })),
          raw: { observed: true },
          model: 'offline-v1',
          usage,
        };
      },
    };
    const record = await createEvaluator({ store, judge, budgetUsd: 0.01 }).grade('trial', {
      graders: [grader(2)],
    });
    assert.equal(calls, 1, 'Known observed overspend must stop the next already-reserved batch.');
    assert.equal(record.requests[0].dispatched, true);
    assert.deepEqual(record.requests[0].response?.usage ?? record.requests[0].observedUsage, usage);
    if (responseKind === 'valid') {
      assert.equal(record.requests[0].receivedResponse, undefined);
      assert.equal(record.requests[0].observedUsage, undefined);
    }
    if (responseKind === 'non-JSON') {
      assert.equal(record.requests[0].receivedResponse, undefined);
      assert.equal(record.requests[0].error, 'Invalid authored response');
    }
    assert.equal(record.requests[1].dispatched, false);
    assert.match(record.requests[1].error!, /budget exceeded/i);
    assert.equal(record.grades[0].verdict, responseKind === 'valid' ? 'pass' : 'unknown');
    assert.equal(record.grades[1].verdict, 'unknown');
    const retained = await store.listGradings('trial');
    assert.equal(retained.length, 1);
    assert.deepEqual(retained[0].requests, record.requests);
  });
}

test('fractional token usage cannot produce a completed grade or validated usage', async (context) => {
  const { directory, store } = await setup();
  context.after(() => rm(directory, { recursive: true, force: true }));
  const judge: Judge = {
    id: 'invalid-usage-judge',
    async prepare(jobs) {
      return [
        {
          id: 'batch',
          jobIds: jobs.map(({ id }) => id),
          body: {},
          metadata: {},
          reservedCostUsd: 0.001,
        },
      ];
    },
    async execute(request) {
      return {
        answers: request.jobIds.map((jobId) => ({ jobId, verdict: 'pass' as const })),
        raw: { response: 'received' },
        model: 'offline-v1',
        usage: { inputTokens: 0.5, outputTokens: 1, estimatedCostUsd: 0.001 },
      };
    },
  };
  const record = await createEvaluator({ store, judge }).grade('trial', { graders: [grader(1)] });
  assert.equal(record.grades[0].verdict, 'unknown');
  assert.equal(record.grades[0].status, 'grader_error');
  assert.equal(record.requests[0].response, undefined);
  assert.equal(record.requests[0].observedUsage, undefined);
  assert.ok(record.requests[0].receivedResponse, 'Unusable response remains inspectable.');
});
