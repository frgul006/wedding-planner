import assert from 'node:assert/strict';
import test from 'node:test';
import { planExperiment, runExperiment } from '../src/application/run-experiment.ts';

test('experiment admission covers every scheduled API call before any execution', () => {
  assert.throws(() => planExperiment(1, 0.00456, 0.005), /budget exceeded before dispatch/);
  const plan = planExperiment(3, 0.00456, 0.03);
  assert.ok(Math.abs(plan.budget.reservedEstimateUsd - 6 * 0.00456) < 1e-10);
  assert.deepEqual(
    plan.steps.map(({ variant }) => variant),
    ['enabled', 'disabled', 'disabled', 'enabled', 'enabled', 'disabled'],
  );
  for (const pairs of [0, 1.5, 11, Number.NaN])
    assert.throws(() => planExperiment(pairs, 0, 1), /between 1 and 10/);
});

test('failed judgments and failed dispatches are retained without dropping the other variant', async () => {
  const plan = planExperiment(2, 0, 1);
  const writes: string[][] = [];
  const attempted: number[] = [];
  const results = await runExperiment(
    plan,
    async (step) => {
      attempted.push(step.index);
      if (step.index === 2) throw new Error('Synthetic startup failure');
      return { verdict: 'fail', index: step.index };
    },
    async (attempts) => {
      writes.push(attempts.map((attempt) => attempt.status));
    },
  );
  assert.deepEqual(attempted, [1, 2, 3, 4]);
  assert.equal(results[0].status, 'recorded');
  assert.equal(results[1].status, 'dispatch_error');
  assert.equal(results[3].status, 'recorded');
  assert.equal(writes.length, 5);
  assert.deepEqual(writes[0], ['not_run', 'not_run', 'not_run', 'not_run']);
});

test('cancellation keeps the completed observation and explicitly retains unstarted attempts', async () => {
  const controller = new AbortController();
  let executed = 0;
  const attempts = await runExperiment(
    planExperiment(1, 0, 1),
    async () => {
      executed++;
      controller.abort();
      return { status: 'completed' };
    },
    async () => {},
    controller.signal,
  );
  assert.equal(executed, 1);
  assert.deepEqual(
    attempts.map((attempt) => attempt.status),
    ['recorded', 'not_run'],
  );
});
