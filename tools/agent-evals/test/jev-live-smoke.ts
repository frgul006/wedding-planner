/**
 * Explicit paid calibration smoke, excluded from the automatic *.test.ts suite.
 * pnpm --filter @wedding-planner/agent-evals exec tsx test/jev-live-smoke.ts --live
 * The evidence below is authored: it is not a native Pi trial or a measured agent result.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, parseEnv } from 'node:util';
import { fileStore } from '../src/adapters/library-file-store.ts';
import { JEV_MODEL, jevJudge } from '../src/adapters/jev-judge.ts';
import { createEvaluator, defineView, modelGrader } from '../src/index.ts';
import type { GradingRecord, Judge, RecordedTrial, TraceEvent } from '../src/index.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const directory = path.join(root, 'evals/runs/library-jev-smoke');
const fixtureLabel = 'Authored calibration fixture; not a native agent trial';
const suffix = `${Date.now()}-${crypto.randomUUID()}`;
const trialId = `authored-diagnosis-${suffix}`;
const runId = `authored-jev-smoke-${suffix}`;

function authoredTrial(): RecordedTrial {
  const texts = [
    {
      role: 'assistant',
      text:
        'Reported bug: after a failed save, the Save button stays disabled. ' +
        'Hypothesis: disabled depends on pending OR error, so a retained error prevents retry. ' +
        'Alternative: a request remains pending. Prediction: while pending is false, clearing only error ' +
        'should enable Save without another request. If pending is false and error is null but Save ' +
        'remains disabled, that would disprove the retained-error hypothesis.',
    },
    {
      role: 'tool-observation',
      text:
        'Before any edit, a controlled browser probe observed pending=false, error="Request failed", ' +
        'Save disabled=true. The probe cleared only the error, kept the field values unchanged, and observed ' +
        'pending=false, error=null, Save disabled=false. No new network request occurred.',
    },
    {
      role: 'assistant',
      text:
        'The observed transition supports the retained-error hypothesis and contradicts the pending-request ' +
        'alternative. I will now make the disabled predicate depend only on pending.',
    },
  ];
  const events: TraceEvent[] = texts.map((data, index) => ({
    id: `authored-event-${index + 1}`,
    sequence: index + 1,
    timestamp: `2026-09-27T10:00:0${index}.000Z`,
    actor: 'agent',
    type: 'message',
    data,
    source: { origin: 'authored-calibration', nativeObservation: false },
  }));
  return {
    id: trialId,
    task: {
      id: 'authored-retry-diagnosis',
      version: 1,
      prompt: 'Authored fixture for evaluating diagnostic questions about a disabled retry button.',
      metadata: { fixtureLabel, nativeAgentExecuted: false },
    },
    status: 'authored_fixture',
    trace: { events, artifacts: [], contexts: [], complete: true, gaps: [] },
    outcome: { fixtureLabel, realApplicationTested: false },
    metadata: { fixtureLabel, nativeAgentExecuted: false },
  };
}

const view = defineView({
  id: 'authored-diagnostic-episode',
  version: 1,
  prepare: (trial: RecordedTrial) => [
    {
      id: 'before-edit',
      data: {
        fixtureLabel,
        purpose:
          'Judge the logic of the authored episode; make no claim that these observations happened.',
        episode: trial.trace.events.map(({ id, sequence, data }) => ({
          sourceRef: id,
          sequence,
          ...data,
        })),
      },
      scope: 'One authored hypothesis and probe before the proposed edit.',
      sourceRefs: trial.trace.events.map(({ id }) => id),
      coverage: { complete: true, gaps: [] },
      omissions: [
        'No real agent, browser, tool, code change, or application execution took place.',
      ],
      applicability: 'applicable' as const,
    },
  ],
});

function graders(version: 1 | 2) {
  return [
    modelGrader({
      id: 'authored-falsifiable-hypothesis',
      version,
      view,
      question:
        version === 1
          ? 'Within this authored episode, does the hypothesis name an observable outcome that would disprove it?'
          : 'Within this authored episode, does the hypothesis state both the controlled conditions and the observable outcome that would disprove the retained-error explanation?',
      rubric: {
        pass: 'The hypothesis states a concrete observation that would contradict its explanation, with the controlled conditions clear from the episode.',
        fail: 'The hypothesis gives only supporting expectations, or names no observation that could contradict it.',
        unknown:
          'The authored episode does not contain enough of the hypothesis or its predicted observations to decide.',
      },
    }),
    modelGrader({
      id: 'authored-discriminating-probe',
      version: 1,
      view,
      question:
        'Within this authored episode, does the probe before the proposed edit distinguish the stated hypothesis from its alternative using different observable predictions?',
      rubric: {
        pass: 'The before-edit probe observes the controlled condition and resulting behavior that support one explanation while contradicting the stated alternative.',
        fail: 'The before-edit probe could not distinguish the explanations, or its stated observation contradicts the claimed distinction.',
        unknown:
          'The episode lacks the probe result, its timing, or the alternative needed to assess the distinction.',
      },
    }),
  ];
}

function summary(record: GradingRecord) {
  return {
    gradingId: record.id,
    trialId: record.trialId,
    trialHash: record.trialHash,
    report: path.join(directory, 'gradings', record.id, 'report.md'),
    requests: record.requests.map(({ request, response, error, dispatched }) => ({
      requestId: request.id,
      questions: request.jobIds.length,
      dispatched,
      model: response?.model ?? null,
      usage: response?.usage ?? null,
      reservedCostUsd: request.reservedCostUsd,
      error: error ?? null,
    })),
    grades: record.grades.map(({ grader, verdict, status }) => ({ grader, verdict, status })),
  };
}

async function main() {
  const { values } = parseArgs({
    options: { live: { type: 'boolean', default: false } },
    strict: true,
  });
  if (!values.live) {
    console.log(
      'No requests made. Use --live to run two paid Jev batches over an authored calibration fixture (total reserved allowance <= $0.01).',
    );
    return;
  }
  const apiKey = parseEnv(
    await readFile(path.join(root, '.env.local'), 'utf8'),
  ).TYPESAFE_API_KEY?.trim();
  if (!apiKey) throw new Error('TYPESAFE_API_KEY is missing or empty in the worktree .env.local.');
  const store = fileStore(directory);
  const delegate = jevJudge({ apiKey, maxRequests: 1, timeoutMs: 30_000 });
  const providerErrors: string[] = [];
  const judge: Judge = {
    id: delegate.id,
    async prepare(jobs) {
      const requests = await delegate.prepare(jobs);
      assert.equal(
        requests.length,
        1,
        'Calibration must prepare exactly one shared-state request.',
      );
      assert.equal(requests[0].jobIds.length, 2, 'Calibration must batch exactly two questions.');
      return requests;
    },
    async execute(request, signal) {
      try {
        return await delegate.execute(request, signal);
      } catch (error) {
        // jevJudge has already removed SDK bodies, credentials, headers, and nested causes.
        providerErrors.push(
          error instanceof Error && ['JevJudgeError', 'AbortError'].includes(error.name)
            ? error.message
            : 'The judge failed without a safe diagnostic.',
        );
        throw error;
      }
    },
  };
  const evaluator = createEvaluator({ store, judge, budgetUsd: 0.005 });
  await store.saveTrial(authoredTrial());
  const trialPath = path.join(directory, 'trials', `${trialId}.json`);
  const originalTrial = await readFile(trialPath, 'utf8');
  const first = await evaluator.grade(trialId, { graders: graders(1) });
  await store.saveRun({
    id: runId,
    suiteId: 'authored-jev-calibration',
    trialIds: [trialId],
    gradingIds: [first.id],
  });
  console.log(
    JSON.stringify({ fixtureLabel, runId, initial: summary(first), providerErrors }, null, 2),
  );
  if (!first.requests[0]?.response || first.grades.some(({ status }) => status !== 'completed')) {
    process.exitCode = 1;
    return;
  }
  const [revised] = await evaluator.regrade(runId, { graders: graders(2) });
  assert.equal(
    await readFile(trialPath, 'utf8'),
    originalTrial,
    'Regrading must preserve the original trial byte for byte.',
  );
  assert.equal(
    (await store.listGradings(trialId)).length,
    2,
    'Both grading records must be retained.',
  );
  console.log(
    JSON.stringify(
      {
        fixtureLabel,
        runId,
        revised: summary(revised),
        providerErrors,
        unchangedTrial: true,
        nativeAgentExecuted: false,
        totalEstimatedCostUsd: [first, revised]
          .flatMap(({ requests }) => requests)
          .reduce((sum, { response }) => sum + (response?.usage.estimatedCostUsd ?? 0), 0),
      },
      null,
      2,
    ),
  );
  if (
    !revised.requests[0]?.response ||
    revised.grades.some(({ status }) => status !== 'completed')
  ) {
    process.exitCode = 1;
    return;
  }
  assert.equal(first.requests[0].response.model, JEV_MODEL);
  assert.equal(revised.requests[0].response.model, JEV_MODEL);
}

main().catch(() => {
  console.error(
    'Jev authored calibration could not complete. Inspect retained records in evals/runs/library-jev-smoke; no raw exception or credential was logged.',
  );
  process.exitCode = 1;
});
