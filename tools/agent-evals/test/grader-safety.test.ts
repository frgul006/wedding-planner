import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyCitations } from '../src/adapters/ai-sdk-grader.ts';
import { redact } from '../src/adapters/secrets.ts';
import { EstimatedBudget, estimateCost } from '../src/domain/budget.ts';

test('structured semantic verdict requires evidence IDs and verbatim quotes', () => {
  const grade = {
    verdict: 'pass' as const,
    reason: 'Clear',
    evidence: [{ id: 'a1', quote: 'schedule' }],
  };
  assert.doesNotThrow(() => verifyCitations(grade, { a1: 'View the wedding schedule' }));
  assert.throws(() => verifyCitations(grade, { a1: 'Details' }));
  assert.throws(() => verifyCitations(grade, { a2: 'schedule' }));
  assert.throws(() => verifyCitations({ ...grade, evidence: [] }, {}));
  assert.doesNotThrow(() => verifyCitations({ ...grade, verdict: 'unknown', evidence: [] }, {}));
});
test('known keys, bearer credentials and JWTs are removed from persisted text', () => {
  const text = redact('secret-value Bearer opaque-token sk-abcdefghijklmno eyJabcd.abcdef.abcdef', [
    'secret-value',
  ]);
  for (const forbidden of ['secret-value', 'opaque-token', 'sk-abcdefghijklmno', 'eyJabcd'])
    assert.ok(!text.includes(forbidden));
});
test('budget admission rejects excess and invalid reservations before dispatch', () => {
  const budget = new EstimatedBudget(1);
  budget.reserve(0.9);
  budget.reserve(0.02);
  assert.throws(() => budget.reserve(0.09));
  assert.throws(() => budget.reserve(NaN));
  assert.throws(() => new EstimatedBudget(10));
  assert.equal(
    estimateCost(1000, 1000, { inputPerMillion: 0.2, outputPerMillion: 1.2, source: 'test' }),
    0.0014,
  );
});
