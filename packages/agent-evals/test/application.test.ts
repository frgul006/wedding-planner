import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTrial } from '../src/adapters/pi/run-trial.ts';
import type {
  AgentResult,
  AgentRunner,
  Artifact,
  CommandCheck,
  EvidenceEvent,
  PreparedEnvironment,
} from '../src/adapters/pi/types.ts';
import type { EvaluationTask } from '../src/index.ts';

const task: EvaluationTask = {
  id: 'docs',
  version: '1',
  prompt: 'Update docs',
};
const options = {
  id: 'failure',
  task,
  limits: { runtimeMs: 100, maxTokens: 10, maxTurns: 100 },
  maxEstimatedCostUsd: 0.1,
  expectedModel: { provider: 'test', id: 'test', thinkingLevel: 'low' },
  manifest: {},
};
test('setup failure persists failed attempt and never dispatches agent', async () => {
  const saved = new Map<string, unknown>();
  let dispatched = false;
  const agent: AgentRunner = {
    async run() {
      dispatched = true;
      throw new Error('must not dispatch');
    },
  };
  const result = await runTrial(options, {
    environment: {
      async prepare() {
        throw new Error('fixture missing');
      },
    },
    agent,
    store: {
      async save(n, v) {
        saved.set(n, v);
      },
      append() {},
    },
  });
  assert.equal(dispatched, false);
  assert.equal(result.evidence.agent.status, 'infrastructure_error');
  assert.ok(saved.has('manifest.json'));
  assert.ok(saved.has('evidence.json'));
  assert.equal(result.manifest.error, 'fixture missing');
});
function completed(): AgentResult {
  return {
    status: 'completed',
    startedAt: '2026-09-07T12:00:00Z',
    endedAt: '2026-09-07T12:00:01Z',
    exitCode: 0,
    signal: null,
    model: { id: 'test' },
    thinkingLevel: 'low',
    usage: {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      estimatedCostUsd: 0.01,
      costSource: 'offline estimate',
    },
  };
}
const target: Artifact = {
  id: 'target',
  path: 'README.md',
  content: 'Start with pnpm dev',
  sha256: 'a'.repeat(64),
  observedBy: 'evaluator',
};
function prepared(overrides: Partial<PreparedEnvironment> = {}): PreparedEnvironment {
  return {
    root: '/isolated',
    workspace: '/isolated/workspace',
    url: 'http://127.0.0.1:1234',
    env: {},
    agentArgs: [],
    provenance: {},
    async collectArtifacts() {
      return [target];
    },
    async cleanup() {},
    ...overrides,
  };
}

test('resolved per-trial limits reach the agent and remain in evidence and manifest', async () => {
  const limits = { runtimeMs: 100, maxTokens: 10, maxTurns: 3 };
  const limitUsage = {
    runtimeMs: 75,
    turns: 3,
    turnsStarted: 3,
    weightedTokens: 8.5,
    cachedTokenWeight: 0.1,
  };
  const limitHit = { kind: 'maxTurns' as const, threshold: 3, observed: 3 };
  const saved = new Map<string, unknown>();
  const result = await runTrial(
    { ...options, task: { ...task, limits: { maxTurns: 7 } }, limits },
    {
      environment: {
        async prepare() {
          return prepared();
        },
      },
      agent: {
        async run(request) {
          assert.deepEqual(request.limits, limits);
          return { ...completed(), status: 'budget_exceeded', limits, limitUsage, limitHit };
        },
      },
      store: {
        async save(name, value) {
          saved.set(name, value);
        },
        append() {},
      },
    },
  );
  assert.deepEqual(result.evidence.agent.limits, limits);
  assert.deepEqual(result.evidence.agent.limitHit, limitHit);
  assert.deepEqual(result.manifest.limitUsage, limitUsage);
  assert.deepEqual(result.manifest.limits, limits);
  assert.deepEqual(result.manifest.limitHit, limitHit);
  assert.equal(saved.get('evidence.json'), result.evidence);
});

test('prepared resource fingerprints and runtime remain in their environment recording', async () => {
  const saved = new Map<string, unknown>();
  const runtime = { node: { version: '24.15.0' } };
  const skillTreeFingerprint = 'a'.repeat(64);
  await runTrial(options, {
    environment: {
      async prepare() {
        return prepared({ provenance: { runtime, skillTreeFingerprint } });
      },
    },
    agent: {
      async run() {
        return completed();
      },
    },
    store: {
      async save(name, value) {
        saved.set(name, value);
      },
      append() {},
    },
  });
  assert.deepEqual(saved.get('environment.json'), {
    runtime,
    skillTreeFingerprint,
  });
});

test('cleanup failure preserves completed task evidence and reports infrastructure failure', async () => {
  const saved = new Map<string, unknown>();
  let cleaned = false;
  const environment = prepared({
    async cleanup() {
      cleaned = true;
      throw new Error('Browser process did not stop');
    },
  });
  const result = await runTrial(options, {
    environment: {
      async prepare() {
        return environment;
      },
    },
    agent: {
      async run() {
        return completed();
      },
    },
    store: {
      async save(name, value) {
        saved.set(name, value);
      },
      append() {},
    },
  });
  assert.equal(cleaned, true);
  assert.equal(result.evidence.agent.status, 'infrastructure_error');
  assert.equal(result.manifest.statusBeforeCleanupFailure, 'completed');
  assert.equal(result.manifest.cleanupError, 'Browser process did not stop');
  assert.deepEqual(
    result.evidence.artifacts,
    [target],
    'captured outcome survives cleanup failure',
  );
  assert.equal(result.evidence.agent.usage.inputTokens, 100);
  assert.ok(saved.has('evidence.json'));
  assert.equal(saved.has('grades.json'), false);
  assert.equal(saved.has('grading-results.json'), false);
  assert.ok(
    result.evidence.events.some(
      (event) => event.actor === 'evaluator' && event.data.type === 'cleanup_error',
    ),
  );
});

test('final artifact collection failure still cleans up and leaves missing outcome unknown', async () => {
  let collections = 0;
  let cleaned = false;
  const environment = prepared({
    async collectArtifacts() {
      if (++collections === 1) {
        return [target];
      }
      throw new Error('Artifact capture interrupted');
    },
    async cleanup() {
      cleaned = true;
    },
  });
  const result = await runTrial(options, {
    environment: {
      async prepare() {
        return environment;
      },
    },
    agent: {
      async run() {
        return completed();
      },
    },
    store: { async save() {}, append() {} },
  });
  assert.equal(cleaned, true);
  assert.equal(result.evidence.agent.status, 'infrastructure_error');
  assert.deepEqual(result.evidence.artifacts, []);
  assert.ok(
    result.evidence.events.some((event) => event.data.type === 'artifact_collection_error'),
  );
});

test('an agent adapter exception still captures artifacts, cleans up, and saves the failed attempt', async () => {
  let cleaned = false;
  const saved = new Set<string>();
  const result = await runTrial(options, {
    environment: {
      async prepare() {
        return prepared({
          async cleanup() {
            cleaned = true;
          },
        });
      },
    },
    agent: {
      async run(request) {
        request.onEvent({
          id: 'partial-event',
          sequence: 1,
          timestamp: '2026-09-27T00:00:00Z',
          actor: 'agent',
          kind: 'pi',
          data: { type: 'turn_start' },
        });
        throw new Error('RPC transport disconnected');
      },
    },
    store: {
      async save(name) {
        saved.add(name);
      },
      append() {},
    },
  });
  assert.equal(cleaned, true);
  assert.equal(result.evidence.agent.status, 'infrastructure_error');
  assert.equal(result.manifest.error, 'RPC transport disconnected');
  assert.deepEqual(result.evidence.artifacts, [target]);
  const agentEvents = result.evidence.events.filter((event) => event.actor === 'agent');
  assert.equal(agentEvents.length, 1);
  assert.equal(agentEvents[0].data.type, 'turn_start');
  assert.ok(saved.has('manifest.json') && saved.has('evidence.json'));
});

test('finalized independent checks are saved with the attempt without producing grading records', async () => {
  const saved = new Map<string, unknown>();
  const stages: string[] = [];
  let evidenceWrites = 0;
  const checks: CommandCheck[] = [
    {
      id: 'acceptance',
      actor: 'evaluator',
      command: ['trusted-acceptance'],
      exitCode: 1,
      stdout: 'Retry still fails',
      stderr: '',
      status: 'fail',
    },
  ];
  const result = await runTrial(options, {
    environment: {
      async prepare(actualTask, id) {
        assert.equal(actualTask, task);
        assert.equal(id, options.id);
        return prepared({
          async finalize() {
            stages.push('finalize');
            return { artifacts: [target], checks, changedFiles: [target.path] };
          },
          async cleanup() {
            stages.push('cleanup');
          },
        });
      },
    },
    agent: {
      async run() {
        return completed();
      },
    },
    store: {
      append() {},
      async save(name, value) {
        saved.set(name, value);
        if (name === 'evidence.json') {
          stages.push('saved');
          evidenceWrites++;
        }
      },
    },
  });
  assert.deepEqual(stages, ['finalize', 'cleanup', 'saved']);
  assert.equal(evidenceWrites, 1);
  assert.equal(result.evidence.agent.status, 'completed');
  assert.deepEqual(result.evidence.checks, checks);
  assert.deepEqual(result.evidence.changedFiles, [target.path]);
  assert.equal(saved.get('evidence.json'), result.evidence);
  assert.equal(saved.has('grades.json'), false);
  assert.equal(saved.has('grading-results.json'), false);
  assert.equal(result.evidence.variant, undefined);
});

test('callback tool events are sequenced with environment observations and keep their actor', async () => {
  const appended: EvidenceEvent[] = [];
  const result = await runTrial(options, {
    environment: {
      async prepare() {
        return prepared();
      },
    },
    agent: {
      async run(request) {
        request.onEvent({
          id: 'pi-event-1',
          sequence: 1,
          timestamp: '2026-09-07T12:00:00Z',
          actor: 'agent',
          kind: 'pi',
          data: { type: 'agent_start' },
        });
        assert.equal(
          appended.at(-1)?.data.type,
          'agent_start',
          'recorded before the agent returns',
        );
        return completed();
      },
    },
    store: { async save() {}, append: (event) => appended.push(event) },
  });
  assert.deepEqual(
    result.evidence.events.map((event) => event.sequence),
    result.evidence.events.map((_, index) => index + 1),
  );
  const toolEvent = result.evidence.events.find((event) => event.data.type === 'agent_start');
  assert.equal(toolEvent?.actor, 'agent');
  assert.equal(result.evidence.events[0].actor, 'environment');
  assert.deepEqual(
    result.evidence.events.filter((event) => event.actor === 'agent'),
    [toolEvent],
  );
  assert.equal('events' in result.evidence.agent, false);
  assert.deepEqual(appended, result.evidence.events);
});

test('final artifacts are observed after tool descendants stop', async () => {
  let stopped = false;
  let collections = 0;
  const environment = prepared({
    async collectArtifacts() {
      if (++collections > 1) {
        assert.equal(stopped, true, 'final evidence cannot race active tool children');
      }
      return [target];
    },
    async cleanup() {
      stopped = true;
    },
  });
  await runTrial(options, {
    environment: {
      async prepare() {
        return environment;
      },
    },
    agent: {
      async run() {
        return completed();
      },
    },
    store: { async save() {}, append() {} },
  });
  assert.equal(collections, 2);
});

test('cancellation during preparation skips Pi, cleans up, and saves a cancelled trial', async () => {
  const controller = new AbortController();
  const saved = new Map<string, unknown>();
  let cleaned = false;
  const result = await runTrial(
    { ...options, signal: controller.signal },
    {
      environment: {
        async prepare() {
          controller.abort();
          return prepared({
            async cleanup() {
              cleaned = true;
            },
          });
        },
      },
      agent: {
        async run() {
          assert.fail('Cancelled preparation must not start Pi');
        },
      },
      store: {
        async save(name, value) {
          saved.set(name, value);
        },
        append() {},
      },
    },
  );
  assert.equal(cleaned, true);
  assert.equal(result.evidence.agent.status, 'cancelled');
  assert.equal(result.manifest.status, 'cancelled');
  assert.deepEqual(result.evidence.artifacts, [target]);
  assert.ok(saved.has('evidence.json') && saved.has('manifest.json'));
});

test('cancelled Pi usage and artifacts survive cleanup and remain ready for sealing', async () => {
  const controller = new AbortController();
  const saved = new Map<string, unknown>();
  let cleaned = false;
  const result = await runTrial(
    { ...options, signal: controller.signal },
    {
      environment: {
        async prepare() {
          return prepared({
            async cleanup() {
              cleaned = true;
            },
          });
        },
      },
      agent: {
        async run(request) {
          assert.equal(request.signal, controller.signal);
          controller.abort();
          return { ...completed(), status: 'cancelled', error: 'Evaluation cancelled by user.' };
        },
      },
      store: {
        async save(name, value) {
          saved.set(name, value);
        },
        append() {},
      },
    },
  );
  assert.equal(result.evidence.agent.status, 'cancelled');
  assert.equal(result.evidence.agent.usage.estimatedCostUsd, 0.01);
  assert.deepEqual(result.evidence.artifacts, [target]);
  assert.equal(saved.get('evidence.json'), result.evidence);
  assert.equal(saved.get('manifest.json'), result.manifest);
  assert.equal(cleaned, true);
  assert.equal(saved.has('grades.json'), false);
});
