import type { View } from '../src/index.ts';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { JEV_MODEL, jevJudge } from '../src/adapters/jev/index.ts';
import { fileStore } from '../src/adapters/files.ts';
import { createEvaluator, modelGrader } from '../src/index.ts';

const key = 'offline-jev-journal-review-credential';
const view = {
  id: 'authored-diagnosis',
  version: 1,
  prepare: () => [
    {
      id: 'episode',
      data: { observation: 'Authored diagnostic observation' },
      scope: 'Authored fixture only',
      sourceRefs: [],
      coverage: { complete: true, gaps: [] },
      omissions: [],
      applicability: 'applicable' as const,
    },
  ],
} satisfies View;
const graders = [
  modelGrader({
    id: 'diagnostic-check',
    version: 1,
    view,
    question: 'Is there an observable prediction?',
    rubric: {
      pass: 'A prediction is observable',
      fail: 'No prediction is stated',
      unknown: 'Evidence is incomplete',
    },
  }),
];
async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), 'eval-jev-journal-'));
  const store = fileStore(directory);
  await store.saveTrial({
    id: 'authored-trial',
    task: { id: 'authored', version: 1, prompt: 'Authored fixture' },
    status: 'completed',
    trace: { events: [], artifacts: [], contexts: [], complete: true, gaps: [] },
    outcome: {},
    metadata: {},
  });
  return { directory, store };
}

test('oversize Jev preparation retains exact evidence and an actionable preparation error without dispatch', async (context) => {
  const { directory, store } = await setup();
  context.after(() => rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const judge = jevJudge({
    apiKey: key,
    maxStateChars: 20,
    fetch: async () => {
      calls++;
      throw new Error('Must not dispatch');
    },
  });
  const record = await createEvaluator({ store, judge }).grade('authored-trial', { graders });
  assert.equal(calls, 0);
  assert.equal(record.requests.length, 0);
  assert.equal(record.evidence.length, 1);
  assert.deepEqual(record.evidence[0].data, { observation: 'Authored diagnostic observation' });
  assert.equal(record.grades[0].verdict, 'unknown');
  assert.equal(record.grades[0].status, 'preparation_error');
  assert.match(
    record.grades[0].reason!,
    /exceeds configured character limits; no content was truncated/,
  );
  assert.equal((await store.listGradings('authored-trial')).length, 1);
});

test('Jev invalid answers preserve redacted received data and billed usage through the core journal', async (context) => {
  const { directory, store } = await setup();
  context.after(() => rm(directory, { recursive: true, force: true }));
  const received = {
    model: JEV_MODEL,
    answers: {},
    usage: { input_tokens: 321, output_tokens: 12 },
    echo: key,
  };
  let calls = 0;
  const judge = jevJudge({
    apiKey: key,
    fetch: async () => {
      calls++;
      return new Response(JSON.stringify(received), {
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  const record = await createEvaluator({ store, judge }).grade('authored-trial', { graders });
  assert.equal(calls, 1);
  assert.equal(record.grades[0].verdict, 'unknown');
  assert.equal(record.grades[0].status, 'grader_error');
  assert.equal(record.requests[0].response, undefined);
  assert.deepEqual(record.requests[0].receivedResponse, { ...received, echo: '[REDACTED]' });
  assert.deepEqual(record.requests[0].observedUsage, {
    inputTokens: 321,
    outputTokens: 12,
    estimatedCostUsd: (321 * 0.042) / 1_000_000,
  });
  const [retained] = await store.listGradings('authored-trial');
  assert.deepEqual(retained.requests, record.requests);
  const report = await readFile(path.join(directory, 'gradings', record.id, 'report.md'), 'utf8');
  assert.match(report, /321/);
  assert.match(report, /\[REDACTED\]/);
  assert.ok(!report.includes(key));
  assert.ok(!JSON.stringify(retained).includes(key));
  assert.equal(retained.requests[0].error, 'Jev response has missing or unexpected answer IDs.');
});

for (const status of [401, 429, 503]) {
  test(`Jev HTTP ${status} diagnostics survive grading without provider error bodies`, async (context) => {
    const { directory, store } = await setup();
    context.after(() => rm(directory, { recursive: true, force: true }));
    const privateBody = `${key} private provider response`;
    const judge = jevJudge({
      apiKey: key,
      fetch: async () =>
        new Response(JSON.stringify({ message: privateBody }), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
    });
    const record = await createEvaluator({ store, judge }).grade('authored-trial', { graders });
    const reason = `Jev request failed with HTTP ${status}.`;
    assert.equal(record.requests[0].error, reason);
    assert.equal(record.requests[0].receivedResponse, undefined);
    assert.equal(record.grades[0].status, 'grader_error');
    assert.equal(record.grades[0].reason, reason);
    const [retained] = await store.listGradings('authored-trial');
    const report = await readFile(path.join(directory, 'gradings', record.id, 'report.md'), 'utf8');
    assert.equal(retained.requests[0].error, reason);
    assert.ok(report.includes(reason));
    assert.ok(!report.includes(privateBody));
    assert.ok(!JSON.stringify(retained).includes(key));
  });
}
