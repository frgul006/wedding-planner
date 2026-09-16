import assert from 'node:assert/strict';
import test from 'node:test';
import { directApiCost, gradingCost } from '../src/cli/grading-view.ts';
import type { GradingResult, TrialEvidence } from '../src/domain/types.ts';

const usage = (cost: number | null) => ({
  inputTokens: 1,
  outputTokens: 1,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  estimatedCostUsd: cost,
  costSource: 'test estimate',
});
const result = (metering: GradingResult['metering'], cost?: number | null): GradingResult => ({
  grader: 'independent-grader',
  version: '1',
  status: 'completed',
  grades: [],
  metering,
  ...(cost !== undefined ? { usage: usage(cost) } : {}),
});

test('all API graders are counted and failed unknown usage cannot become zero', () => {
  assert.equal(
    gradingCost([result('none'), result('semantic-api', 0.01), result('semantic-api', 0.02)]),
    0.03,
  );
  assert.equal(gradingCost([{ ...result('semantic-api'), status: 'grader_error' }]), null);
  assert.equal(gradingCost([result('semantic-api')]), null);
  assert.equal(gradingCost([{ ...result('none'), status: 'grader_error' }]), 0);
  assert.equal(gradingCost([result('semantic-api', null)]), null);
});

test('experiment API total excludes subscription catalog estimates and retains API-billed agents', () => {
  const evidence = { agent: { usage: usage(0.5) } } as TrialEvidence;
  const trials = [
    { evidence, gradingResults: [result('semantic-api', 0.01), result('semantic-api', 0.02)] },
  ];
  assert.equal(directApiCost(trials, 'subscription'), 0.03);
  assert.equal(directApiCost(trials, 'api'), 0.53);
  evidence.agent.usage = usage(null);
  assert.equal(directApiCost(trials, 'api'), null);
  assert.equal(directApiCost(trials, 'subscription'), 0.03);
});
