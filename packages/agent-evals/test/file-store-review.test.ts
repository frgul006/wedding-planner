import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileStore } from '../src/adapters/files.ts';
import { contentHash } from '../src/core/serialization.ts';
import { createEvaluator } from '../src/index.ts';
import type { GradingRecord, JudgeRequest, RecordedTrial, SuiteRun } from '../src/index.ts';

function trial(): RecordedTrial {
  return {
    id: 'snapshot-trial',
    task: { id: 'fixture', version: 1, prompt: 'Original task prompt' },
    status: 'completed',
    trace: {
      events: [
        {
          id: 'event-1',
          sequence: 1,
          timestamp: '2026-09-27T00:00:00.000Z',
          actor: 'agent',
          type: 'message',
          data: { text: 'Original observation' },
        },
      ],
      artifacts: [],
      contexts: [],
      complete: true,
      gaps: [],
    },
    outcome: {},
    metadata: {},
  };
}

test('file store snapshots trial, run and request before asynchronous persistence', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'eval-save-snapshot-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const store = fileStore(directory);
  const original = trial();
  const expectedTrial = structuredClone(original);
  const trialSave = store.saveTrial(original);
  original.status = 'mutated-during-save';
  original.trace.events[0].data.text = 'Mutated observation';
  await trialSave;
  assert.deepEqual(await store.loadTrial(expectedTrial.id), expectedTrial);

  const run: SuiteRun = {
    id: 'snapshot-run',
    suiteId: 'fixture-suite',
    trialIds: [expectedTrial.id],
    gradingIds: [],
  };
  const expectedRun = structuredClone(run);
  const runSave = store.saveRun(run);
  run.suiteId = 'mutated-suite';
  run.trialIds.push('mutated-trial');
  await runSave;
  assert.deepEqual(await store.loadRun(expectedRun.id), expectedRun);

  const request: JudgeRequest = {
    id: 'snapshot-request',
    jobIds: ['job-1'],
    body: { state: { text: 'Original state' } },
    metadata: { trialId: expectedTrial.id },
    reservedCostUsd: 0.001,
  };
  const expectedRequest = structuredClone(request);
  const requestSave = store.saveRequest('snapshot-grading', request);
  (request.body.state as { text: string }).text = 'Mutated state';
  request.jobIds.push('mutated-job');
  await requestSave;
  const saved = JSON.parse(
    await readFile(
      path.join(directory, 'gradings/snapshot-grading/requests/snapshot-request.json'),
      'utf8',
    ),
  );
  assert.deepEqual(saved.value, expectedRequest);
  assert.equal(saved.contentHash, await contentHash(expectedRequest));
});

test('file store grading JSON and report share the call-time snapshot despite concurrent mutation', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'eval-grading-snapshot-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const store = fileStore(directory);
  const savedTrial = trial();
  await store.saveTrial(savedTrial);
  const record: GradingRecord = {
    id: 'snapshot-grading',
    trialId: savedTrial.id,
    trialHash: await contentHash(savedTrial),
    createdAt: '2026-09-27T00:00:00.000Z',
    evidence: [],
    jobs: [],
    requests: [],
    grades: [],
    rollups: [
      {
        grader: 'original-grader',
        verdict: 'pass',
        counts: { pass: 1, fail: 0, unknown: 0, not_applicable: 0 },
        rule: 'Original aggregation rule',
      },
    ],
  };
  const expected = structuredClone(record);
  const pending = store.saveGrading(record);
  record.id = 'mutated-grading';
  record.rollups[0].grader = 'mutated-grader';
  record.rollups[0].verdict = 'fail';
  record.rollups[0].rule = 'Mutated aggregation rule';
  await pending;
  const [retained] = await store.listGradings(savedTrial.id);
  assert.deepEqual(retained, expected);
  const report = await readFile(
    path.join(directory, 'gradings/snapshot-grading/report.md'),
    'utf8',
  );
  assert.match(report, /original-grader \| pass/);
  assert.match(report, /Original aggregation rule/);
  assert.doesNotMatch(report, /mutated-grader|Mutated aggregation rule/);
});

test('interrupted regrade journals do not hide completed history and remain unchanged', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'eval-empty-grading-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const store = fileStore(directory);
  await store.saveTrial(trial());
  const evaluator = createEvaluator({ store });
  const first = await evaluator.grade(trial().id, { graders: [] });
  await store.saveRun({
    id: 'recorded-run',
    suiteId: 'fixture',
    trialIds: [trial().id],
    gradingIds: [first.id],
  });
  await mkdir(path.join(directory, 'gradings/empty-interrupted-grading'), { recursive: true });

  await store.saveRequest('journaled-interrupted-grading', {
    id: 'request',
    jobIds: ['job'],
    body: {},
    metadata: { trialId: trial().id, gradingId: 'journaled-interrupted-grading' },
    reservedCostUsd: 0,
  });
  const journal = path.join(
    directory,
    'gradings/journaled-interrupted-grading/requests/request.json',
  );
  const originalRequest = await readFile(journal, 'utf8');
  assert.deepEqual(await store.listGradings(trial().id), [first]);
  const [regraded] = await evaluator.regrade('recorded-run', { graders: [] });
  assert.deepEqual(
    (await store.listGradings(trial().id)).map(({ id }) => id).sort(),
    [first.id, regraded.id].sort(),
  );
  assert.equal(await readFile(journal, 'utf8'), originalRequest);
  assert.deepEqual(await store.listGradings('unrelated-trial'), []);
});

test('completed grading records still fail integrity checks after damage', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'eval-damaged-grading-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const store = fileStore(directory);
  await store.saveTrial(trial());
  const record = await createEvaluator({ store }).grade(trial().id, { graders: [] });
  const file = path.join(directory, 'gradings', record.id, 'grading.json');
  const envelope = JSON.parse(await readFile(file, 'utf8'));
  envelope.value.createdAt = 'changed-after-save';
  await writeFile(file, JSON.stringify(envelope));
  await assert.rejects(store.listGradings(trial().id), /integrity check failed/);
});
