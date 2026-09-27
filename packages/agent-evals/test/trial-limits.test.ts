import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_TRIAL_LIMITS, resolveTrialLimits, weightedTokens } from '../src/index.ts';
import type { TrialLimits } from '../src/index.ts';

test('per-trial defaults inherit fieldwise and explicit higher limits are never clamped', () => {
  assert.deepEqual(resolveTrialLimits(), {
    runtimeMs: 1_800_000,
    maxTurns: 100,
    maxTokens: 1_000_000,
  });
  assert.deepEqual(
    resolveTrialLimits({ maxTurns: 10 }, { runtimeMs: 7_200_000, maxTokens: 10_000_000 }),
    {
      runtimeMs: 7_200_000,
      maxTurns: 10,
      maxTokens: 10_000_000,
    },
  );
  assert.equal(resolveTrialLimits({ maxTurns: 3 }, { maxTurns: undefined }).maxTurns, 3);
  assert.equal(DEFAULT_TRIAL_LIMITS.maxTurns, 100);
});

test('invalid limits cannot silently disable stopping or overflow the runtime timer', () => {
  for (const key of ['runtimeMs', 'maxTurns', 'maxTokens'])
    for (const value of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null, '10'])
      assert.throws(() => resolveTrialLimits({ [key]: value } as Partial<TrialLimits>));
  assert.throws(() => resolveTrialLimits({ runtimeMs: 2_147_483_648 }), /timer range/);
  assert.throws(
    () => resolveTrialLimits({ maxTurn: 2 } as Partial<TrialLimits>),
    /Unknown trial limit/,
  );
});

test('cached reads and writes count one tenth without changing raw provider usage', () => {
  const usage = {
    inputTokens: 43_906,
    outputTokens: 8_737,
    cacheReadTokens: 310_272,
    cacheWriteTokens: 10,
  };
  const before = { ...usage };
  assert.equal(weightedTokens(usage), 83_671.2);
  assert.deepEqual(usage, before);
});
