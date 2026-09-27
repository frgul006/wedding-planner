import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import {
  JsonlDecoder,
  modelMetadata,
  PiRpcRunner,
  UsageAccumulator,
} from '../src/adapters/pi-rpc.js';
import type { AgentRunRequest, EvidenceEvent } from '../src/domain/types.js';
import { endpointHash } from '../src/adapters/pi-endpoint-selection.ts';
import { DEFAULT_TRIAL_LIMITS, type TrialLimits } from '../src/domain/trial-limits.ts';

test('strict LF framing preserves Unicode separators, CRLF, and split UTF-8', () => {
  const received: Record<string, unknown>[] = [];
  const decoder = new JsonlDecoder((value) => received.push(value));
  const bytes = Buffer.from(
    `${JSON.stringify({ text: 'café\u2028same record\u2029still same' })}\r\n`,
  );
  for (const byte of bytes) decoder.push(Buffer.from([byte]));
  decoder.finish();
  assert.deepEqual(received, [{ text: 'café\u2028same record\u2029still same' }]);
});

test('malformed, oversized, and unfinished JSONL records fail visibly', () => {
  assert.throws(() => new JsonlDecoder(() => {}).push(Buffer.from('not-json\n')), SyntaxError);
  assert.throws(() => new JsonlDecoder(() => {}, 5).push(Buffer.from('{"x":123}\n')), /size limit/);
  const decoder = new JsonlDecoder(() => {});
  decoder.push(Buffer.from('{"x":'));
  assert.throws(() => decoder.finish(), /incomplete JSONL/);
});

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

test('model metadata excludes provider credentials and request headers', () => {
  assert.deepEqual(
    modelMetadata({
      id: 'test',
      provider: 'openai-codex',
      headers: { Authorization: 'secret' },
      apiKey: 'secret',
      cost: { input: 1 },
    }),
    { id: 'test', provider: 'openai-codex', cost: { input: 1 } },
  );
});

const fakeRpc = String.raw`#!/usr/bin/env node
const send = event => process.stdout.write(JSON.stringify(event) + '\n');
const scenario = process.env.EVAL_RPC_SCENARIO;
const model = { provider: 'openai-codex', id: 'test-model', baseUrl: 'https://chatgpt.com/backend-api', headers: { Authorization: 'must-not-persist' } };
const usage = { input: 10, output: 5, cacheRead: scenario === 'cached' ? 1000 : 0, cacheWrite: scenario === 'cached' ? 20 : 0, cost: { total: scenario === 'high-cost' ? 25 : 0.01 } };
let pending = '';
process.stdin.on('data', chunk => {
  pending += chunk;
  let index;
  while ((index = pending.indexOf('\n')) !== -1) {
    const command = JSON.parse(pending.slice(0, index)); pending = pending.slice(index + 1);
    if (scenario === 'startup-hang') continue;
    if (command.type === 'get_state') send({ type: 'response', id: command.id, command: command.type, success: true, data: { model, thinkingLevel: 'xhigh' } });
    else if (command.type === 'prompt') {
      if (scenario === 'reject') { send({ type: 'response', id: command.id, command: 'prompt', success: false, error: 'not accepted' }); continue; }
      send({ type: 'response', id: command.id, command: 'prompt', success: true });
      send({ type: 'agent_start' });
      send({ type: 'turn_start' });
      if (scenario === 'exit') { process.exit(7); }
      if (scenario === 'malformed') { process.stdout.write('not JSON\n'); continue; }
      if (scenario === 'hang') continue;
      if (scenario === 'cancel-active') { send({ type: 'message_end', message: { role: 'assistant', usage } }); continue; }
      if (scenario === 'budget') { send({ type: 'message_update', usage: { ...usage, input: 100000 } }); continue; }
      if (scenario === 'multi-turn') {
        for (let turn=1; turn<=3; turn++) {
          if (turn>1) send({type:'turn_start'});
          for(let tool=1; tool<=3; tool++) send({type:'tool_execution_start',toolCallId:turn+'-'+tool,toolName:'bash',args:{command:'true'}});
          send({type:'message_update',usage});
          send({type:'message_update',usage});
          send({type:'message_end',message:{role:'assistant',usage,stopReason:'toolUse'}});
          for(let tool=1; tool<=3; tool++) send({type:'tool_execution_end',toolCallId:turn+'-'+tool,isError:false,result:{content:[]}});
          send({type:'turn_end',message:{role:'assistant'},toolResults:[]});
        }
        send({type:'agent_settled'});continue;
      }
      send({ type: 'tool_execution_start', toolName: 'bash', toolCallId: 'browser', args: { command: 'playwright-cli snapshot' } });
      send({ type: 'tool_execution_end', toolName: 'bash', toolCallId: 'browser', isError: false, result: { content: [{ type: 'text', text: 'snapshot' }] } });
      if (scenario === 'recovered-retry') {
        send({ type: 'message_end', message: { role: 'assistant', usage, stopReason: 'error', errorMessage: 'temporary provider error' } });
        send({type:'turn_end',message:{role:'assistant'},toolResults:[]});
        send({type:'turn_start'});
      }
      send({ type: 'message_end', message: { role: 'assistant', usage, stopReason: scenario === 'provider-error' ? 'error' : 'stop', errorMessage: scenario === 'provider-error' ? 'provider unavailable' : undefined } });
      send({ type: 'turn_end', message: { role: 'assistant' }, toolResults: [] });
      send({ type: 'agent_end', willRetry: false });
      if(scenario==='synchronous-settle') send({type:'agent_settled'});
      else setTimeout(() => { send({ type: 'test_event_after_agent_end' }); send({ type: 'agent_settled' }); }, 30);
    } else if(command.type==='get_session_stats' && ['delayed-stats','delayed-totals'].includes(scenario)) setTimeout(() => send({type:'response',id:command.id,command:command.type,success:true,data:scenario==='delayed-totals'?{tokens:{input:1000,output:10,cacheRead:9000,cacheWrite:0},cost:0.1}:{}}), 1100);
    else if(command.type==='get_session_stats' && scenario==='late-totals') send({type:'response',id:command.id,command:command.type,success:true,data:{tokens:{input:1000,output:10,cacheRead:9000,cacheWrite:0},cost:0.1}});
    else send({ type: 'response', id: command.id, command: command.type, success: true, data: {} });
  }
});
process.stdin.on('end', () => { if (scenario !== 'startup-hang') process.exit(0); });
if (scenario === 'startup-hang') { process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); }
`;

async function trial(
  scenario: string,
  overrides: Omit<Partial<AgentRunRequest>, 'limits'> & { limits?: Partial<TrialLimits> } = {},
  runnerOptions: { requiredExtensionCommand?: string; expectedEndpointHash?: string } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), 'pi-rpc-test-'));
  const executable = join(directory, 'pi-test.cjs');
  await writeFile(executable, fakeRpc, { mode: 0o700 });
  try {
    const events: EvidenceEvent[] = [];
    const result = await new PiRpcRunner(runnerOptions).run({
      cwd: directory,
      env: { PATH: process.env.PATH ?? '', EVAL_RPC_SCENARIO: scenario },
      executable: executable,
      maxEstimatedCostUsd: 1,
      prompt: 'Change a heading',
      expectedModel: { provider: 'openai-codex', id: 'test-model', thinkingLevel: 'xhigh' },
      ...overrides,
      limits: { ...DEFAULT_TRIAL_LIMITS, runtimeMs: 3000, maxTokens: 1000, ...overrides.limits },
      onEvent(event) {
        events.push(event);
        overrides.onEvent?.(event);
      },
    });
    assert.equal('events' in result, false, 'the recorder owns the only retained event list');
    return { ...result, events };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('native RPC run waits for agent_settled and attributes controller versus agent evidence', async () => {
  const result = await trial('pass');
  assert.equal(result.status, 'completed');
  assert.equal(result.exitCode, 0);
  assert.equal(result.usage.inputTokens, 10);
  assert.equal(result.usage.outputTokens, 5);
  assert.ok(result.events.some((event) => event.data.type === 'test_event_after_agent_end'));
  assert.equal(
    result.events.find((event) => event.data.type === 'tool_execution_start')?.actor,
    'agent',
  );
  assert.equal(
    result.events.find((event) => event.data.command === 'get_state')?.actor,
    'evaluator',
  );
  assert.ok(
    !result.events.some((event) =>
      ['set_auto_retry', 'set_auto_compaction'].includes(String(event.data.command)),
    ),
  );
  assert.equal(JSON.stringify(result).includes('must-not-persist'), false);
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

test('provider errors are agent errors; rejected prompts and process failures are infrastructure errors', async () => {
  assert.equal((await trial('provider-error')).status, 'agent_error');
  assert.equal((await trial('reject')).status, 'infrastructure_error');
  const crashed = await trial('exit');
  assert.equal(crashed.status, 'infrastructure_error');
  assert.equal(crashed.exitCode, 7);
  assert.equal((await trial('malformed')).status, 'infrastructure_error');
  const recovered = await trial('recovered-retry');
  assert.equal(recovered.status, 'completed');
  assert.equal(recovered.error, undefined);
  assert.equal(recovered.usage.inputTokens, 20);
});

test('observed token budget and runtime exhaustion remain distinct', async () => {
  const budget = await trial('budget');
  assert.equal(budget.status, 'budget_exceeded');
  assert.match(budget.error ?? '', /token budget/);
  assert.equal(
    budget.events.find((event) => event.data.type === 'stop_requested')?.actor,
    'evaluator',
  );
  const timeout = await trial('hang', { limits: { runtimeMs: 100 } });
  assert.equal(timeout.status, 'timeout');
  assert.equal(timeout.usage.estimatedCostUsd, null);
});

test('subscription trials retain cost estimates without enforcing a dollar threshold', async () => {
  const capped = await trial('high-cost');
  assert.equal(capped.status, 'budget_exceeded');
  assert.match(capped.error ?? '', /estimated agent cost/);
  const subscription = await trial('high-cost', { maxEstimatedCostUsd: null });
  assert.equal(subscription.status, 'completed');
  assert.equal(subscription.usage.estimatedCostUsd, 25);
  const started = subscription.events.find((event) => event.data.type === 'pi_started');
  assert.equal(started?.data.agentCostLimitEnabled, false);
  assert.equal(started?.data.agentCostEstimateIsBilling, false);
  assert.equal(started?.data.maxEstimatedCostUsd, null);
});

test('subscription dollar exemption preserves token limits and runtime deadlines', async () => {
  const budget = await trial('budget', { maxEstimatedCostUsd: null });
  assert.equal(budget.status, 'budget_exceeded');
  assert.match(budget.error ?? '', /token budget/);
  const timeout = await trial('hang', { maxEstimatedCostUsd: null, limits: { runtimeMs: 100 } });
  assert.equal(timeout.status, 'timeout');
});

test('cached reads and writes count at one tenth while raw usage is retained', async () => {
  const allowed = await trial('cached', { limits: { maxTokens: 118 }, maxEstimatedCostUsd: null });
  assert.equal(allowed.status, 'completed');
  assert.equal(allowed.usage.inputTokens, 10);
  assert.equal(allowed.usage.outputTokens, 5);
  assert.equal(allowed.usage.cacheReadTokens, 1000);
  assert.equal(allowed.usage.cacheWriteTokens, 20);
  assert.equal(allowed.limitUsage?.weightedTokens, 117);
  assert.equal(allowed.limitUsage?.cachedTokenWeight, 0.1);
  const capped = await trial('cached', { limits: { maxTokens: 117 }, maxEstimatedCostUsd: null });
  assert.equal(capped.status, 'budget_exceeded');
  assert.deepEqual(capped.limitHit, { kind: 'maxTokens', threshold: 117, observed: 117 });
  assert.equal(capped.usage.cacheReadTokens, 1000);
});

test('a completed native turn includes multiple tools and deltas; the first cap hit remains stable', async () => {
  const result = await trial('multi-turn', {
    limits: { maxTurns: 1, maxTokens: 30 },
    maxEstimatedCostUsd: null,
  });
  assert.equal(result.status, 'budget_exceeded');
  assert.deepEqual(result.limitHit, { kind: 'maxTurns', threshold: 1, observed: 1 });
  const stops = result.events.filter((event) => event.data.type === 'stop_requested');
  assert.equal(stops.length, 1);
  assert.equal((stops[0]!.data.limitUsage as { turns: number }).turns, 1);
  assert.equal((stops[0]!.data.limitUsage as { weightedTokens: number }).weightedTokens, 15);
  const prior = result.events.filter((event) => event.sequence < stops[0]!.sequence);
  assert.equal(prior.filter((event) => event.data.type === 'tool_execution_end').length, 3);
  assert.equal(prior.filter((event) => event.data.type === 'message_update').length, 2);
  assert.equal(prior.filter((event) => event.data.type === 'turn_end').length, 1);
});

test('hitting the completed-turn boundary stops even when that response would naturally finish', async () => {
  const capped = await trial('pass', { limits: { maxTurns: 1 }, maxEstimatedCostUsd: null });
  assert.equal(capped.status, 'budget_exceeded');
  assert.equal(capped.limitHit?.kind, 'maxTurns');
  assert.equal(capped.limitUsage?.turns, 1);
  const below = await trial('pass', { limits: { maxTurns: 2 }, maxEstimatedCostUsd: null });
  assert.equal(below.status, 'completed');
  assert.equal(below.limitUsage?.turns, 1);
  assert.equal(below.limitUsage?.turnsStarted, 1);
  assert.equal(below.limitHit, undefined);
  const retried = await trial('recovered-retry', {
    limits: { maxTurns: 3 },
    maxEstimatedCostUsd: null,
  });
  assert.equal(retried.status, 'completed');
  assert.equal(retried.limitUsage?.turns, 2);
  const tokenFirst = await trial('pass', {
    limits: { maxTokens: 15, maxTurns: 1 },
    maxEstimatedCostUsd: null,
  });
  assert.equal(tokenFirst.limitHit?.kind, 'maxTokens');
  assert.equal(tokenFirst.events.filter((event) => event.data.type === 'stop_requested').length, 1);
});

test('late authoritative session usage exceeding a token cap cannot silently pass after settlement', async () => {
  const result = await trial('late-totals', {
    limits: { maxTokens: 1900 },
    maxEstimatedCostUsd: null,
  });
  assert.equal(result.status, 'budget_exceeded');
  assert.equal(result.limitUsage?.weightedTokens, 1910);
  assert.deepEqual(result.limitHit, { kind: 'maxTokens', threshold: 1900, observed: 1910 });
  assert.ok(
    result.events.find((event) => event.data.type === 'agent_settled')!.sequence <
      result.events.find((event) => event.data.type === 'stop_requested')!.sequence,
  );
  assert.equal(
    result.limitUsage?.runtimeMs,
    (
      result.events.find((event) => event.data.type === 'stop_requested')!.data.limitUsage as {
        runtimeMs: number;
      }
    ).runtimeMs,
  );
});

test('settled execution runtime excludes delayed accounting and shutdown wall time', async () => {
  for (const scenario of ['delayed-stats', 'delayed-totals']) {
    const result = await trial(scenario, {
      limits: { runtimeMs: 1000, maxTokens: 1900 },
      maxEstimatedCostUsd: null,
    });
    assert.ok(result.limitUsage!.runtimeMs < 1000);
    const wallTime = Date.parse(result.endedAt) - Date.parse(result.startedAt);
    assert.ok(wallTime > 1000);
    assert.ok(wallTime - result.limitUsage!.runtimeMs >= 1000);
    assert.ok(result.events.some((event) => event.data.command === 'get_session_stats'));
    if (scenario === 'delayed-stats') {
      assert.equal(result.status, 'completed');
      assert.equal(result.limitHit, undefined);
      assert.equal(
        result.events.some((event) => event.data.type === 'stop_requested'),
        false,
      );
    } else {
      assert.equal(result.status, 'budget_exceeded');
      assert.equal(result.limitUsage!.weightedTokens, 1910);
      assert.deepEqual(result.limitHit, { kind: 'maxTokens', threshold: 1900, observed: 1910 });
      const stop = result.events.find((event) => event.data.type === 'stop_requested')!;
      assert.equal(
        (stop.data.limitUsage as { runtimeMs: number }).runtimeMs,
        result.limitUsage!.runtimeMs,
      );
    }
  }
});

test('runtime stop is observable even if synchronous evidence handling delays its timer', async () => {
  let blocked = false;
  const result = await trial('synchronous-settle', {
    limits: { runtimeMs: 1000, maxTurns: 1 },
    maxEstimatedCostUsd: null,
    onEvent(event) {
      if (event.data.type === 'message_end') {
        blocked = true;
        const until = performance.now() + 1100;
        while (performance.now() < until) {
          /* Simulate a synchronous evidence writer. */
        }
      }
    },
  });
  assert.equal(blocked, true);
  assert.equal(result.status, 'timeout');
  assert.equal(result.limitHit?.kind, 'runtimeMs');
  assert.ok(result.limitHit!.observed >= 1000);
  assert.equal(result.events.filter((event) => event.data.type === 'stop_requested').length, 1);
});

test('invalid resolved caps fail before starting Pi', async () => {
  for (const override of [
    { maxTurns: 0 },
    { maxTurns: 1.5 },
    { maxTurns: Number.POSITIVE_INFINITY },
    { maxTokens: -1 },
    { runtimeMs: 2_147_483_648 },
  ]) {
    let events = 0;
    await assert.rejects(() =>
      trial('pass', {
        limits: override,
        onEvent() {
          events++;
        },
      }),
    );
    assert.equal(events, 0);
  }
});

test('non-null dollar limits must remain finite and positive', async () => {
  for (const maxEstimatedCostUsd of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(
      () => trial('pass', { maxEstimatedCostUsd }),
      /maxEstimatedCostUsd must be finite and greater than zero/,
    );
  }
});

test('runtime deadline also terminates a hung startup process that ignores SIGTERM', async () => {
  const started = Date.now();
  const result = await trial('startup-hang', { limits: { runtimeMs: 50 } });
  assert.equal(result.status, 'timeout');
  assert.ok(Date.now() - started < 2500);
  assert.equal(result.signal, 'SIGKILL');
  assert.equal(
    result.limitUsage?.runtimeMs,
    (
      result.events.find((event) => event.data.type === 'stop_requested')!.data.limitUsage as {
        runtimeMs: number;
      }
    ).runtimeMs,
  );
  assert.ok(
    Date.parse(result.endedAt) - Date.parse(result.startedAt) > result.limitUsage!.runtimeMs,
  );
});

test('configuration mismatch prevents prompting and grader key cannot enter Pi', async () => {
  const result = await trial('pass', {
    expectedModel: { provider: 'openai-codex', id: 'other', thinkingLevel: 'xhigh' },
  });
  assert.equal(result.status, 'infrastructure_error');
  assert.ok(!result.events.some((event) => event.data.command === 'prompt'));
  await assert.rejects(
    () => trial('pass', { env: { OPENAI_API_KEY: 'test-fixture-secret' } }),
    /must not enter/,
  );
});

test('failed isolation extension load prevents any prompt from reaching Pi', async () => {
  const result = await trial('pass', {}, { requiredExtensionCommand: 'eval-sandbox-ready-v1' });
  assert.equal(result.status, 'infrastructure_error');
  assert.match(result.error ?? '', /Required isolation extension did not register/);
  assert.ok(!result.events.some((event) => event.data.command === 'prompt'));
});

test('evidence writer failure stops the process while retaining in-memory evidence', async () => {
  const result = await trial('pass', {
    onEvent: () => {
      throw new Error('disk full');
    },
  });
  assert.equal(result.status, 'infrastructure_error');
  assert.match(result.error ?? '', /Evidence writer failed: disk full/);
  assert.equal(result.events.filter((event) => event.data.type === 'stop_requested').length, 1);
  assert.deepEqual(
    result.events.map((event) => event.sequence),
    result.events.map((_, index) => index + 1),
  );
  assert.ok(!result.events.some((event) => event.data.command === 'prompt'));
});

test('cancelling an active Pi request sends native abort, closes the child, and retains usage', async () => {
  const controller = new AbortController();
  const result = await trial('cancel-active', {
    signal: controller.signal,
    onEvent(event) {
      if (event.data.type === 'message_end') controller.abort();
    },
  });
  assert.equal(result.status, 'cancelled');
  assert.equal(result.usage.inputTokens, 10);
  assert.equal(result.usage.estimatedCostUsd, 0.01);
  assert.equal(result.exitCode, 0);
  assert.ok(result.events.some((event) => event.data.command === 'abort'));
  assert.equal(
    result.events.find((event) => event.data.type === 'stop_requested')?.data.reason,
    'cancelled',
  );
});

test('cancellation during stuck startup kills a child that ignores native abort and SIGTERM', async () => {
  const controller = new AbortController();
  const started = Date.now();
  const result = await trial('startup-hang', {
    signal: controller.signal,
    onEvent(event) {
      if (event.data.type === 'pi_started') controller.abort();
    },
  });
  assert.equal(result.status, 'cancelled');
  assert.equal(result.signal, 'SIGKILL');
  assert.ok(Date.now() - started < 2500);
});

test('already cancelled requests do not start Pi or dispatch prompts', async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await trial('pass', { signal: controller.signal, executable: '/does-not-exist' });
  assert.equal(result.status, 'cancelled');
  assert.equal(result.exitCode, null);
  assert.equal(
    result.events.some((event) => event.data.type === 'pi_started'),
    false,
  );
});

test('explicit endpoint identity is checked before prompting Pi', async () => {
  const mismatch = await trial(
    'pass',
    {},
    { expectedEndpointHash: endpointHash('http://127.0.0.1:8787/v1') },
  );
  assert.equal(mismatch.status, 'infrastructure_error');
  assert.match(mismatch.error ?? '', /endpoint.*no prompt was sent/);
  assert.equal(
    mismatch.events.some((event) => event.data.command === 'prompt'),
    false,
  );
  const match = await trial(
    'pass',
    {},
    { expectedEndpointHash: endpointHash('https://chatgpt.com/backend-api') },
  );
  assert.equal(match.status, 'completed');
});
