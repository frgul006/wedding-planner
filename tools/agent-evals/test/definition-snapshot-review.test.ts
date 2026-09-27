import type { View } from '../src/index.ts';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileStore } from '../src/adapters/library-file-store.ts';
import { createEvaluator, modelGrader } from '../src/index.ts';
import type { EvaluationTask, Judge, RecordedTrial, Suite } from '../src/index.ts';

const originalTask = (): EvaluationTask => ({
  id: 'fixture-task',
  version: 1,
  prompt: 'Original task prompt',
  metadata: { scope: 'Original scope' },
});
const recorded = (id: string, task = originalTask()): RecordedTrial => ({
  id,
  task,
  status: 'completed',
  trace: { events: [], artifacts: [], contexts: [], complete: true, gaps: [] },
  outcome: {},
  metadata: {},
});
function definitions() {
  let preparations = 0;
  const view = {
    id: 'original-view',
    version: 1,
    prepare: () => {
      preparations++;
      return [
        {
          id: 'item',
          data: { observation: 'Original observation' },
          scope: 'Authored fixture',
          sourceRefs: [],
          coverage: { complete: true, gaps: [] },
          omissions: [],
          applicability: 'applicable' as const,
        },
      ];
    },
  } satisfies View;
  const grader = modelGrader({
    id: 'original-grader',
    version: 1,
    view,
    question: 'Original question?',
    rubric: {
      pass: 'Original pass criteria',
      fail: 'Original fail criteria',
      unknown: 'Original unknown criteria',
    },
  });
  return {
    view,
    grader,
    preparations: () => preparations,
    mutate() {
      view.id = 'changed-view';
      view.version = 2;
      view.prepare = () => [];
      grader.id = 'changed-grader';
      grader.version = 2;
      grader.question = 'Changed question?';
      grader.rubric.pass = 'Changed pass criteria';
    },
  };
}
function judge(afterDispatch: () => void = () => {}): Judge {
  return {
    id: 'offline-snapshot-judge',
    async prepare(jobs) {
      return [
        {
          id: 'batch',
          jobIds: jobs.map(({ id }) => id),
          body: { questions: jobs.map(({ question, rubric }) => ({ question, rubric })) },
          metadata: {},
          reservedCostUsd: 0,
        },
      ];
    },
    async execute(request) {
      afterDispatch();
      return {
        answers: request.jobIds.map((jobId) => ({ jobId, verdict: 'pass' as const })),
        raw: { observed: true },
        model: 'offline-v1',
        usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
      };
    },
  };
}
function assertOriginal(record: Awaited<ReturnType<ReturnType<typeof createEvaluator>['grade']>>) {
  assert.equal(record.jobs[0].grader.id, 'original-grader');
  assert.equal(record.jobs[0].grader.version, 1);
  assert.equal(record.jobs[0].question, 'Original question?');
  assert.equal(record.jobs[0].rubric.pass, 'Original pass criteria');
  assert.deepEqual(record.grades[0].grader, { id: 'original-grader', version: 1 });
  assert.deepEqual(record.evidence[0].view, { id: 'original-view', version: 1 });
  const sent = record.requests[0].request.body.questions as Array<{
    question: string;
    rubric: { pass: string };
  }>;
  assert.equal(sent[0].question, record.jobs[0].question);
  assert.equal(sent[0].rubric.pass, record.jobs[0].rubric.pass);
}

test('grade snapshots definitions before asynchronous loading and keeps records aligned with dispatched questions', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'eval-grade-definitions-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const base = fileStore(directory);
  await base.saveTrial(recorded('original-trial'));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const store = {
    ...base,
    async loadTrial(id: string) {
      await gate;
      return base.loadTrial(id);
    },
  };
  const authored = definitions();
  const evaluator = createEvaluator({ store, judge: judge() });
  const pending = evaluator.grade('original-trial', { graders: [authored.grader] });
  authored.mutate();
  release();
  const result = await pending;
  assertOriginal(result);
  assert.equal(authored.preparations(), 1);
  assert.equal((await base.listGradings('original-trial')).length, 1);
});

test('run snapshots tasks, suite identity and shared grader definitions across repetitions', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'eval-run-definitions-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const store = fileStore(directory);
  const authored = definitions();
  const second = modelGrader({ ...authored.grader, id: 'second-grader' });
  const suite: Suite = {
    id: 'original-suite',
    tasks: [originalTask()],
    graders: [authored.grader, second],
  };
  let attempts = 0;
  const evaluator = createEvaluator({
    store,
    judge: judge(),
    runner: {
      async run(task, options) {
        attempts++;
        assert.deepEqual(task, originalTask());
        if (attempts === 1) {
          authored.mutate();
          second.version = 2;
          suite.id = 'changed-suite';
          suite.tasks[0].prompt = 'Changed task prompt';
          suite.tasks[0].metadata!.scope = 'Changed scope';
        }
        return recorded(options.trialId, structuredClone(task));
      },
    },
  });
  const run = await evaluator.run(suite, { repetitions: 2 });
  assert.equal(run.suiteId, 'original-suite');
  assert.equal(attempts, 2);
  assert.equal(
    authored.preparations(),
    2,
    'Shared view prepares once per trial, across both graders.',
  );
  for (const trialId of run.trialIds) {
    const [record] = await store.listGradings(trialId);
    assertOriginal(record);
    assert.equal(record.grades[1].grader.version, 1);
    assert.deepEqual((await store.loadTrial(trialId)).task, originalTask());
  }
});

test('regrade retains one definition snapshot across all saved trials while dispatch mutates the caller', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'eval-regrade-definitions-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const store = fileStore(directory);
  const ids = ['first-trial', 'second-trial'];
  for (const id of ids) await store.saveTrial(recorded(id));
  await store.saveRun({
    id: 'saved-run',
    suiteId: 'original-suite',
    trialIds: ids,
    gradingIds: [],
  });
  const authored = definitions();
  const evaluator = createEvaluator({ store, judge: judge(authored.mutate) });
  const records = await evaluator.regrade('saved-run', { graders: [authored.grader] });
  assert.equal(records.length, 2);
  assert.equal(authored.preparations(), 2);
  records.forEach(assertOriginal);
});
