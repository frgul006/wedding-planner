import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTrial } from '../src/application/run-trial.ts';
import { compareTrials } from '../src/domain/report.ts';
import type {
  AgentResult,
  AgentRunner,
  Artifact,
  PreparedEnvironment,
  Task,
} from '../src/domain/types.ts';
import { gradeOutcome, gradeTrial } from '../src/domain/deterministic-graders.ts';
const task: Task = {
  id: 'docs',
  version: '1',
  kind: 'docs',
  prompt: 'Update docs',
  targetFile: 'README.md',
  expectedText: 'pnpm dev',
  flowPath: '/',
};
const options = {
  id: 'failure',
  task,
  variant: 'enabled' as const,
  runtimeMs: 100,
  maxTokens: 10,
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
    grader: {
      async grade() {
        return [];
      },
    },
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
  assert.equal(result.manifest.attempts[0].error, 'fixture missing');
});
test('controlled comparisons reject mismatched budgets and duplicate instructions', () => {
  const a = { variant: 'enabled', invariants: { budget: 1 }, comparisonEligible: true };
  const b = { ...a, variant: 'disabled' };
  assert.equal(compareTrials(a, b).eligible, true);
  assert.equal(compareTrials(a, { ...b, invariants: { budget: 2 } }).eligible, false);
  assert.equal(compareTrials(a, { ...b, comparisonEligible: false }).eligible, false);
  assert.equal(compareTrials(a, a).eligible, false);
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
    events: [],
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
  path: task.targetFile,
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

test('saved comparison invariants include the prepared resource fingerprint and runtime', async () => {
  const saved = new Map<string, unknown>();
  const runtime = { node: { version: '24.15.0' } };
  const skillTreeFingerprint = 'a'.repeat(64);
  await runTrial(
    { ...options, manifest: { invariants: { profile: 'same-profile' } } },
    {
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
      grader: {
        async grade() {
          return [];
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
  const manifest = saved.get('manifest.json') as { invariants: Record<string, unknown> };
  assert.deepEqual(manifest.invariants, {
    profile: 'same-profile',
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
    grader: {
      async grade(evidence) {
        return gradeTrial(evidence);
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
  assert.equal(
    gradeOutcome(result.evidence).verdict,
    'pass',
    'known task outcome survives cleanup failure',
  );
  assert.equal(result.evidence.agent.usage.inputTokens, 100);
  assert.ok(saved.has('grades.json'));
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
      if (++collections === 1) return [target];
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
    grader: {
      async grade(evidence) {
        return gradeTrial(evidence);
      },
    },
    store: { async save() {}, append() {} },
  });
  assert.equal(cleaned, true);
  assert.equal(result.evidence.agent.status, 'infrastructure_error');
  assert.deepEqual(result.evidence.artifacts, []);
  assert.equal(gradeOutcome(result.evidence).verdict, 'unknown');
  const observation = result.evidence.events.find(
    (event) => event.data.type === 'trial_observation',
  );
  assert.equal(
    observation?.data.targetAfterContent,
    undefined,
    'missing capture is not an observed empty file',
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
      async run() {
        throw new Error('RPC transport disconnected');
      },
    },
    grader: {
      async grade(evidence) {
        return gradeTrial(evidence);
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
  assert.equal(result.manifest.attempts[0].error, 'RPC transport disconnected');
  assert.deepEqual(result.evidence.artifacts, [target]);
  assert.ok(saved.has('manifest.json') && saved.has('evidence.json') && saved.has('grades.json'));
});

test('trial evidence is persisted before a failing grader runs and its failure is recorded separately', async () => {
  const saved = new Map<string, unknown>();
  const result = await runTrial(options, {
    environment: {
      async prepare() {
        return prepared();
      },
    },
    agent: {
      async run() {
        return completed();
      },
    },
    grader: {
      async grade() {
        assert.ok(saved.has('evidence.json'), 'paid trial already saved before grading');
        throw new Error('Invalid rubric');
      },
    },
    store: {
      async save(name, value) {
        saved.set(name, value);
      },
      append() {},
    },
  });
  assert.equal(result.evidence.agent.status, 'completed');
  assert.equal(result.grades[0].verdict, 'unknown');
  const error = result.evidence.events.find((event) => event.data.type === 'grader_error');
  assert.ok(error);
  assert.deepEqual(result.grades[0].evidenceRefs, [error.id]);
  assert.ok(saved.has('grades.json') && saved.has('manifest.json'));
});

test('callback tool events are sequenced with environment observations and keep their actor', async () => {
  const result = await runTrial(options, {
    environment: {
      async prepare() {
        return prepared();
      },
    },
    agent: {
      async run(request) {
        request.onEvent?.({
          id: 'pi-event-1',
          sequence: 1,
          timestamp: '2026-09-07T12:00:00Z',
          actor: 'agent',
          kind: 'pi',
          data: { type: 'agent_start' },
        });
        return completed();
      },
    },
    grader: {
      async grade() {
        return [];
      },
    },
    store: { async save() {}, append() {} },
  });
  assert.deepEqual(
    result.evidence.events.map((event) => event.sequence),
    result.evidence.events.map((_, index) => index + 1),
  );
  const toolEvent = result.evidence.events.find((event) => event.data.type === 'agent_start');
  assert.equal(toolEvent?.actor, 'agent');
  assert.equal(result.evidence.events[0].actor, 'environment');
  assert.equal(result.evidence.events.at(-1)?.actor, 'evaluator');
  assert.deepEqual(result.evidence.agent.events, [toolEvent]);
});

test('final artifacts are observed after tool descendants stop', async () => {
  let stopped = false;
  let collections = 0;
  const environment = prepared({
    async collectArtifacts() {
      if (++collections > 1)
        assert.equal(stopped, true, 'final evidence cannot race active tool children');
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
    grader: {
      async grade(evidence) {
        return gradeTrial(evidence);
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
      grader: {
        async grade(evidence) {
          return gradeTrial(evidence);
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
  assert.ok(saved.has('evidence.json') && saved.has('grades.json') && saved.has('manifest.json'));
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
      grader: {
        async grade(evidence, signal) {
          assert.equal(cleaned, true);
          assert.equal(signal, controller.signal);
          return gradeTrial(evidence);
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
  assert.equal(saved.get('grades.json'), result.grades);
});

test('cancelling grading preserves the completed Pi result and saved usage', async () => {
  const controller = new AbortController();
  const saved = new Map<string, unknown>();
  const result = await runTrial(
    { ...options, signal: controller.signal },
    {
      environment: {
        async prepare() {
          return prepared();
        },
      },
      agent: {
        async run() {
          return completed();
        },
      },
      grader: {
        async grade(_evidence, signal) {
          assert.ok(saved.has('evidence.json'));
          controller.abort();
          signal?.throwIfAborted();
          return [];
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
  assert.equal(result.evidence.agent.status, 'completed');
  assert.equal(result.evidence.agent.usage.estimatedCostUsd, 0.01);
  assert.equal(result.grades[0].verdict, 'unknown');
  assert.match(result.grades[0].reason, /cancelled/);
  assert.equal(result.evidence.events.at(-1)?.data.type, 'grader_cancelled');
  assert.equal(saved.get('manifest.json'), result.manifest);
});
