import assert from 'node:assert/strict';
import test from 'node:test';
import { compareTrials } from '../src/domain/comparison.ts';
import { isolatedPiSettings } from '../src/adapters/isolation/pi-configuration.ts';

const baseline = {
  variant: 'enabled',
  comparisonEligible: true,
  invariants: {
    revision: 'same-app',
    model: { id: 'model-a' },
    agentConfiguration: { runtime: 'native' },
    harnessHash: 'same-evaluator',
  },
  grading: { version: 'same-grader' },
};

test('model comparisons allow only the declared model factor', () => {
  const alternative = {
    ...baseline,
    invariants: { ...baseline.invariants, model: { id: 'model-b' } },
  };
  assert.equal(compareTrials(baseline, alternative, { factor: 'model' }).eligible, true);
  assert.equal(compareTrials(baseline, alternative).eligible, false);
  assert.equal(
    compareTrials(
      { ...baseline, invariants: { ...baseline.invariants, model: undefined } },
      alternative,
      { factor: 'model' },
    ).eligible,
    false,
  );
  assert.equal(
    compareTrials(baseline, { ...alternative, variant: 'disabled' }, { factor: 'model' }).eligible,
    false,
  );
  const changedGrader = compareTrials(
    baseline,
    { ...alternative, grading: { version: 'other' } },
    { factor: 'model' },
  );
  assert.equal(changedGrader.eligible, false);
  assert.equal(changedGrader.mismatches[0]?.path, 'grading.version');
});

test('configuration comparisons keep evaluator implementation and workload fixed', () => {
  const alternative = {
    ...baseline,
    invariants: { ...baseline.invariants, agentConfiguration: { runtime: 'controlled' } },
  };
  assert.equal(
    compareTrials(baseline, alternative, { factor: 'agent-configuration' }).eligible,
    true,
  );
  const changedEvaluator = {
    ...alternative,
    invariants: { ...alternative.invariants, harnessHash: 'other' },
  };
  assert.equal(
    compareTrials(baseline, changedEvaluator, { factor: 'agent-configuration' }).eligible,
    false,
  );
  assert.equal(
    compareTrials(baseline, baseline, { factor: 'agent-configuration' }).eligible,
    false,
  );
});

test('native runtime preserves conversation policy and controlled runtime is an explicit change', () => {
  const saved = {
    defaultModel: 'selected-model',
    compaction: { enabled: true, reserveTokens: 12000 },
    retry: { enabled: true, maxRetries: 2 },
    transport: 'sse',
    packages: ['arbitrary-code'],
    extensions: ['arbitrary-tools'],
  };
  const native = isolatedPiSettings(saved, 'native');
  assert.deepEqual(native.compaction, saved.compaction);
  assert.deepEqual(native.retry, saved.retry);
  assert.equal(native.defaultModel, saved.defaultModel);
  assert.deepEqual(native.extensions, []);
  const controlled = isolatedPiSettings(saved, 'controlled');
  assert.deepEqual(controlled.compaction, { enabled: false });
  assert.deepEqual(controlled.retry, {
    enabled: false,
    maxRetries: 0,
    provider: { maxRetries: 0 },
  });
  assert.equal(saved.compaction.enabled, true);
});
