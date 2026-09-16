import assert from 'node:assert/strict';
import test from 'node:test';
import { compareTrials, invariantMismatches } from '../src/domain/comparison.ts';
import { renderComparisonReport, renderReport } from '../src/domain/report.ts';
import type { EvidenceEvent, Grade, TrialEvidence } from '../src/domain/types.ts';

function evidence(): TrialEvidence {
  return {
    task: {
      id: 'docs',
      version: '1',
      kind: 'docs',
      prompt: 'Update local development notes',
      targetFile: 'README.md',
      expectedText: 'pnpm dev',
      flowPath: '/',
    },
    variant: 'enabled',
    localUrl: 'http://127.0.0.1:3000',
    artifacts: [],
    events: [],
    agent: {
      status: 'completed',
      startedAt: '2026-09-07T12:00:00Z',
      endedAt: '2026-09-07T12:02:07Z',
      exitCode: 0,
      signal: null,
      model: { provider: 'openai-codex', id: 'test-model' },
      thinkingLevel: 'xhigh',
      events: [],
      usage: {
        inputTokens: 32_083,
        outputTokens: 4_704,
        cacheReadTokens: 181_248,
        cacheWriteTokens: 0,
        estimatedCostUsd: 0.4,
        costSource: 'catalog estimate',
      },
    },
  };
}

const passing: Grade = {
  grader: 'target-outcome',
  version: '2',
  verdict: 'pass',
  reason: 'The changed file contains the requested command.',
  evidenceRefs: ['a1', 'a1'],
};

test('reports all configured API graders and describes repository trials accurately', () => {
  const trial = evidence();
  trial.task.environment = 'repository';
  const report = renderReport('configured', trial, [], undefined, {
    gradingResults: [
      {
        grader: 'second-model-grader',
        version: '1',
        metering: 'semantic-api',
        status: 'completed',
        grades: [],
        criteria: { model: 'custom-model' },
        usage: { ...trial.agent.usage, estimatedCostUsd: 0.03 },
      },
      {
        grader: 'failed-model-grader',
        version: '1',
        metering: 'semantic-api',
        status: 'grader_error',
        grades: [],
      },
    ],
  });
  assert.match(report, /second-model-grader/);
  assert.match(report, /custom-model.*completed.*\$0\.030000/);
  assert.match(report, /failed-model-grader.*grader.*error.*unknown/);
  assert.match(report, /pinned repository revision/);
  assert.doesNotMatch(report, /not run \(no API cost\)|synthetic fixture/);
});
function lifecycle(
  type: string,
  message: string,
  actor: EvidenceEvent['actor'] = 'evaluator',
): EvidenceEvent {
  return {
    id: 'e1',
    sequence: 1,
    timestamp: '',
    actor,
    kind: 'lifecycle',
    data: { type, message },
  };
}

test('a failed trial reports its cause before otherwise passing judgments', () => {
  const trial = evidence();
  trial.agent.status = 'infrastructure_error';
  trial.agent.error = 'RPC transport disconnected';
  trial.events.push(lifecycle('infrastructure_error', trial.agent.error));
  const report = renderReport('saved-trial', trial, [passing]);
  assert.ok(
    report.indexOf('Infrastructure: RPC transport disconnected') < report.indexOf('## Judgments'),
  );
  assert.equal(report.match(/RPC transport disconnected/g)?.length, 1);
  assert.match(report, /Trial status: \*\*infrastructure_error\*\*/);
  assert.match(report, /\*\*pass\*\*/);
  assert.match(report, /duration: 2m 7\.0s/);
  assert.match(report, /openai-codex\/test-model/);
  assert.match(report, /reasoning: \*\*xhigh\*\*/);
  assert.match(report, /32,083 input, 4,704 output, 181,248 cache read/);
});

test('cleanup and grader problems are distinct from agent execution and ignore agent claims', () => {
  const trial = evidence();
  trial.events.push(lifecycle('cleanup_error', 'Browser did not stop'));
  trial.events.push(lifecycle('grader_error', 'Deterministic parser rejected evidence'));
  trial.events.push(lifecycle('infrastructure_error', 'Invented failure', 'agent'));
  const report = renderReport('saved-trial', trial, [passing], {
    status: 'grader_error',
    model: 'cheap-grader',
    usage: { estimatedCostUsd: null },
    grade: { ...passing, verdict: 'unknown', reason: 'Unverifiable quotation' },
  });
  assert.match(report, /Cleanup: Browser did not stop/);
  assert.match(report, /Deterministic grader: Deterministic parser rejected evidence/);
  assert.match(report, /Semantic grader: Unverifiable quotation/);
  assert.doesNotMatch(report, /Invented failure/);
  assert.match(report, /Trial status: \*\*completed\*\*/);
  assert.match(report, /Grader tokens: unknown input, unknown output, unknown cache read/);
});

test('missing cost and runtime metadata remain unknown', () => {
  const trial = evidence();
  trial.agent.model = null;
  trial.agent.thinkingLevel = null;
  trial.agent.startedAt = '';
  trial.agent.usage.estimatedCostUsd = null;
  const report = renderReport('saved-trial', trial, []);
  assert.match(report, /duration: unknown/);
  assert.match(report, /Model: \*\*unknown\*\* · reasoning: \*\*unknown\*\*/);
  assert.match(report, /Agent cost: unknown/);
  assert.doesNotMatch(report, /NaN|\$0\.000000/);
  assert.match(report, /Agent tokens: 32,083 input/);
});

test('missing usage responses are not presented as observed zero tokens', () => {
  const trial = evidence();
  trial.agent.usage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    estimatedCostUsd: null,
    costSource: 'Unknown: agent did not return usage',
  };
  const report = renderReport('saved-trial', trial, [], {
    status: 'grader_error',
    model: 'cheap',
    usage: { ...trial.agent.usage, costSource: 'Unknown: no successful usage response' },
  });
  assert.match(
    report,
    /Agent tokens: unknown input, unknown output, unknown cache read, unknown cache write/,
  );
  assert.match(report, /Grader tokens: unknown input, unknown output, unknown cache read/);
  assert.doesNotMatch(report, /tokens: 0/);
});

test('report text cannot inject HTML or additional Markdown table cells', () => {
  const grade = {
    ...passing,
    reason: 'Bad | cell\n<script>run()</script> **pass**',
    evidenceRefs: ['a|1'],
  };
  const report = renderReport('saved-trial', evidence(), [grade]);
  assert.match(report, /Bad \\\| cell &lt;script&gt;run\(\)&lt;\/script&gt; \\\*\\\*pass\\\*\\\*/);
  assert.match(report, /a\\\|1/);
  assert.doesNotMatch(report, /<script>|cell\n/);
});

test('regrade report preserves trial identity and does not imply new Pi or semantic execution', () => {
  const trial = evidence();
  trial.agent.status = 'budget_exceeded';
  trial.agent.error = 'Observed token limit reached';
  const report = renderReport('regrade-new', trial, [passing], undefined, {
    trialId: 'original-trial',
    regrade: {
      regradedAt: '2026-09-08T01:00:00Z',
      harnessHash: 'new-harness',
      sourceIntegrityHash: 'original-seal',
    },
    availableFiles: ['evidence.json', 'regrade-new.json'],
  });
  assert.match(report, /^# Regrade: regrade-new/);
  assert.match(report, /Trial: \*\*original-trial\*\*/);
  assert.match(report, /Trial status: \*\*budget_exceeded\*\*/);
  assert.match(report, /Pi was not rerun/);
  assert.match(report, /not run for this regrade \(no new API cost\)/);
  assert.match(report, /earlier semantic judgment remains in the original report/);
  assert.match(report, /\[Original trial report\]\(report\.md\)/);
  assert.match(report, /\[regrade-new\.json\]\(regrade-new\.json\)/);
  assert.match(report, /Grading harness: new-harness/);
  assert.match(report, /Source integrity manifest: original-seal/);
  assert.doesNotMatch(report, /\[semantic\.json\]/);
});

test('explicit available files avoid links to evidence that this run did not save', () => {
  const report = renderReport('grader-smoke', evidence(), [passing], undefined, {
    availableFiles: ['evidence.json', 'semantic.json', '../outside.md'],
  });
  assert.match(report, /\[evidence\.json\]\(evidence\.json\)/);
  assert.doesNotMatch(report, /\[manifest\.json\]|\[environment\.json\]|outside\.md/);
});

const enabled = {
  variant: 'enabled',
  comparisonEligible: true,
  invariants: {
    model: { provider: 'pi', id: 'model' },
    rubric: { version: '1', sha256: 'rubric-a' },
  },
};
const disabled = { ...enabled, variant: 'disabled' };

test('comparison is structural, independent of object serialization order', () => {
  const result = compareTrials(enabled, {
    ...disabled,
    invariants: {
      rubric: { sha256: 'rubric-a', version: '1' },
      model: { id: 'model', provider: 'pi' },
    },
  });
  assert.equal(result.eligible, true);
  assert.deepEqual(result.mismatches, []);
});

test('comparison identifies precise model, rubric and selected grading changes', () => {
  const result = compareTrials(
    { ...enabled, grading: { source: 'regrade', versions: { browser: '1' }, rubricHash: 'a' } },
    {
      ...disabled,
      invariants: {
        ...disabled.invariants,
        model: { ...disabled.invariants.model, id: 'other' },
        rubric: { version: '1', sha256: 'rubric-b' },
      },
      grading: { source: 'regrade', versions: { browser: '2' }, rubricHash: 'b' },
    },
  );
  assert.equal(result.eligible, false);
  assert.deepEqual(
    result.mismatches.map((item) => item.path),
    [
      'invariants.model.id',
      'invariants.rubric.sha256',
      'grading.rubricHash',
      'grading.versions.browser',
    ],
  );
  assert.match(result.reason, /invariants\.rubric\.sha256/);
});

test('comparison retains array order, missing keys and absent grading provenance', () => {
  assert.deepEqual(
    invariantMismatches({ skills: ['a', 'b'] }, { skills: ['b', 'a'], extra: true }).map(
      (item) => item.path,
    ),
    ['invariants.extra', 'invariants.skills[0]', 'invariants.skills[1]'],
  );
  const result = compareTrials({ ...enabled, grading: { source: 'regrade' } }, disabled);
  assert.equal(result.eligible, false);
  assert.equal(result.mismatches[0].path, 'grading');
});

test('missing invariants cannot establish a controlled comparison', () => {
  for (const invariants of [undefined, null, {}, []]) {
    const result = compareTrials({ ...enabled, invariants }, { ...disabled, invariants });
    assert.equal(result.eligible, false);
    assert.match(result.reason, /missing or incomplete/);
  }
});

test('comparison report shows selected revision and interrupted execution independently from passing grades', () => {
  const result = compareTrials(enabled, { ...disabled, invariants: { budget: 2 } });
  const report = renderComparisonReport('comparison', result, [
    {
      id: 'interrupted',
      variant: 'enabled',
      status: 'budget_exceeded',
      reportPath: '../interrupted/regrade.json',
      grades: [passing],
      grading: { label: 'Deterministic regrade', harnessHash: 'new', gradedAt: '2026-09-08' },
    },
    { id: 'second', variant: 'disabled', status: 'completed', grades: [] },
  ]);
  assert.match(report, /Controlled comparison: \*\*ineligible\*\*/);
  assert.match(report, /invariants\.budget/);
  assert.match(report, /status: \*\*budget\\_exceeded\*\*/);
  assert.match(report, /\*\*pass\*\*/);
  assert.match(report, /Grading revision: Deterministic regrade/);
  assert.match(report, /Grading revision: Original saved judgments/);
  assert.match(report, /\[Saved report\]\(<\.\.\/interrupted\/regrade\.json>\)/);
});
