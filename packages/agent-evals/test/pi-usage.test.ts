import assert from 'node:assert/strict';
import test from 'node:test';
import { UsageAccumulator } from '../src/adapters/pi/pi-usage.ts';

test('streaming usage is cumulative per message and final usage is counted once', () => {
  const accumulator = new UsageAccumulator();
  assert.equal(accumulator.value().estimatedCostUsd, null);
  assert.equal(accumulator.value().costSource, 'Unknown: no successful usage response');
  const usage = { input: 10, output: 3, cacheRead: 5, cacheWrite: 0, cost: { total: 0.1 } };
  accumulator.accept({ type: 'message_update', usage });
  accumulator.accept({ type: 'message_update', usage: { ...usage, output: 4 } });
  assert.equal(accumulator.value().outputTokens, 4);
  accumulator.accept({
    type: 'message_end',
    message: { role: 'assistant', usage: { ...usage, output: 4 } },
  });
  assert.equal(accumulator.value().inputTokens, 10);
  assert.equal(accumulator.value().outputTokens, 4);
  assert.equal(accumulator.value().estimatedCostUsd, 0.1);
  accumulator.accept({ type: 'message_start' });
  accumulator.accept({ type: 'message_end', message: { role: 'toolResult', usage } });
  assert.equal(accumulator.value().inputTokens, 20);
  assert.equal(accumulator.value().estimatedCostUsd, 0.2);
});

test('native compaction usage is counted and reconciled with session totals without duplication', () => {
  const accumulator = new UsageAccumulator();
  const usage = { input: 10, output: 3, cacheRead: 5, cost: { total: 0.1 } };
  accumulator.accept({ type: 'message_end', message: { role: 'assistant', usage } });
  accumulator.accept({ type: 'compaction_end', result: { usage } });
  assert.equal(accumulator.value().inputTokens, 20);
  assert.equal(accumulator.value().estimatedCostUsd, 0.2);
  accumulator.accept({
    type: 'response',
    command: 'get_session_stats',
    data: { tokens: { input: 20, output: 6, cacheRead: 10 }, cost: 0.2 },
  });
  assert.equal(accumulator.value().inputTokens, 20);
  assert.equal(accumulator.value().estimatedCostUsd, 0.2);
});

test('empty initialized session totals do not turn missing provider usage into zero cost', () => {
  const accumulator = new UsageAccumulator();
  accumulator.accept({ type: 'message_end', message: { role: 'assistant', stopReason: 'error' } });
  accumulator.accept({
    type: 'response',
    command: 'get_session_stats',
    data: {
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      cost: 0,
    },
  });
  assert.equal(accumulator.value().estimatedCostUsd, null);
  accumulator.accept({
    type: 'message_end',
    message: {
      role: 'assistant',
      usage: {
        input: 4,
        output: 1,
        cost: { total: 0 },
      },
    },
  });
  assert.equal(
    accumulator.value().estimatedCostUsd,
    0,
    'A provider-reported zero remains a known estimate',
  );
});
