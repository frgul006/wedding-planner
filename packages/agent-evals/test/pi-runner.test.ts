import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { piRunner, type PiRunnerOptions } from '../src/adapters/pi/pi-runner.ts';
import { hash } from '../src/adapters/pi/file-run-store.ts';
import { recordedTrialFromEvidence } from '../src/adapters/pi/recorded-trial.ts';
import type { inspectPi } from '../src/adapters/pi/pi-inspection.ts';
import type { AgentResult, PreparedEnvironment } from '../src/adapters/pi/types.ts';
import type { TrialLimits } from '../src/index.ts';

const task = { id: 'toy-document', version: 1, prompt: 'Repair this local text file.' };
const endpoint = 'https://offline.example.invalid/v1';
const billing = { type: 'subscription', maxEstimatedCostUsd: null } as const;

async function setup() {
  // A second consumer: no Git checkout, task catalog, application server or browser.
  const root = await mkdtemp(join(tmpdir(), 'pi-toy-consumer-'));
  const agentDir = join(root, 'native-agent');
  await mkdir(agentDir);
  await writeFile(
    join(agentDir, 'models.json'),
    JSON.stringify({ providers: { 'openai-codex': { baseUrl: endpoint } } }),
  );
  const defaults = { provider: 'openai-codex', model: 'saved-model', thinkingLevel: 'xhigh' };
  const inspection: Awaited<ReturnType<typeof inspectPi>> = {
    executable: 'offline-pi',
    packageRoot: '/offline/pi',
    version: 'offline',
    agentDir,
    authentication: { provider: 'openai-codex', type: 'oauth' },
    defaults,
    conversationSettings: {},
    rpc: {
      model: { provider: 'openai-codex', id: 'saved-model' },
      thinkingLevel: 'xhigh',
      availableModels: [{ provider: 'openai-codex', id: 'toy-model' }],
      inspectionProfile: 'Offline inspection',
    },
    resources: {
      cwd: root,
      projectTrusted: true,
      savedTrust: true,
      instructions: [],
      skills: [],
      skillCandidates: [],
      extensions: [],
      prompts: [],
      systemPrompts: [],
      skillDiagnostics: [],
      missingPackages: [],
      duplicateInstructionSources: [],
      metadataSource: 'Offline fixture',
    },
  };
  const recordingsDirectory = join(root, 'recordings');
  const environment = (): PreparedEnvironment => ({
    root,
    workspace: root,
    env: {},
    agentArgs: [],
    provenance: {
      recordedContexts: [
        {
          id: 'context',
          path: 'AGENTS.md',
          kind: 'effective-instruction',
          content: 'Check changed text.',
          sha256: hash('Check changed text.'),
        },
      ],
      contextCaptureGaps: [],
    },
    async collectArtifacts() {
      return [];
    },
    async cleanup() {},
  });
  return { root, recordingsDirectory, inspection, environment };
}

function completed(): AgentResult {
  return {
    status: 'completed',
    startedAt: '',
    endedAt: '',
    exitCode: 0,
    signal: null,
    model: null,
    thinkingLevel: null,
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      estimatedCostUsd: null,
      costSource: 'offline',
    },
  };
}

test('saved native conversion retains legacy task fields and current metadata', () => {
  const trial = recordedTrialFromEvidence('historical', {
    task: { ...task, fixtureRevision: 'saved-revision', metadata: { purpose: 'saved-purpose' } },
    agent: completed(),
    artifacts: [],
    events: [],
  });
  assert.deepEqual(trial.task.metadata, {
    fixtureRevision: 'saved-revision',
    purpose: 'saved-purpose',
  });
});

test('each Pi trial resolves adapter, task and request limits before consumer setup', async () => {
  const { root, recordingsDirectory, inspection, environment } = await setup();
  const prepared: TrialLimits[] = [];
  const dispatched: TrialLimits[] = [];
  try {
    const runner = piRunner(
      {
        agentSource: root,
        recordingsDirectory,
        billing,
        limits: { runtimeMs: 7_200_000, maxTurns: 200, maxTokens: 1_500_000 },
        async prepareEnvironment(context) {
          prepared.push(context.limits);
          assert.equal(context.pi.defaults.model, 'saved-model');
          assert.equal(context.pi.endpointSelection.effective.sha256, hash(endpoint));
          return environment();
        },
      },
      {
        inspect: async ({ cwd }) => {
          assert.equal(cwd, root);
          return inspection;
        },
        execute: async (request) => {
          dispatched.push(request.limits);
          return completed();
        },
      },
    );
    const first = await runner.run(
      { ...task, limits: { maxTurns: 400, maxTokens: 6_000_000 } },
      { trialId: 'first', limits: { maxTokens: 8_000_000 } },
    );
    await runner.run(task, { trialId: 'second', limits: { runtimeMs: 1000, maxTurns: 2 } });
    const expected = [
      { runtimeMs: 7_200_000, maxTurns: 400, maxTokens: 8_000_000 },
      { runtimeMs: 1000, maxTurns: 2, maxTokens: 1_500_000 },
    ];
    assert.deepEqual(prepared, expected);
    assert.deepEqual(dispatched, expected);
    assert.deepEqual(first.metadata.limits, expected[0]);
    assert.equal(first.metadata.cachedTokenWeight, 0.1);
    await assert.rejects(
      runner.run(task, { trialId: 'invalid', limits: { maxTurns: 0 } }),
      /positive safe integer/,
    );
    assert.equal(prepared.length, 2);
    await assert.rejects(stat(join(recordingsDirectory, 'invalid')), { code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('constructor snapshots data options while retaining its required environment callback', async () => {
  const { root, recordingsDirectory, inspection } = await setup();
  let prepared = false;
  const options: PiRunnerOptions = {
    agentSource: root,
    recordingsDirectory,
    billing,
    limits: { runtimeMs: 1000 },
    async prepareEnvironment(context) {
      prepared = true;
      assert.deepEqual(context.limits, { runtimeMs: 1000, maxTurns: 3, maxTokens: 100 });
      assert.equal(context.task.prompt, task.prompt);
      assert.equal(Object.isFrozen(context.task), true);
      assert.equal(Object.isFrozen(context.limits), true);
      throw new Error('Stop before native dispatch');
    },
  };
  const runner = piRunner(options, {
    inspect: async () => inspection,
    execute: async () => assert.fail('Failed environment setup must not dispatch Pi'),
  });
  const authoredTask = { ...task, limits: { maxTurns: 3 } };
  const request = { trialId: 'snapshot', limits: { maxTokens: 100 } };
  try {
    options.limits!.runtimeMs = 2000;
    options.prepareEnvironment = async () =>
      assert.fail('Callback was replaced after construction');
    const running = runner.run(authoredTask, request);
    authoredTask.limits.maxTurns = 30;
    authoredTask.prompt = 'Mutated prompt';
    request.limits.maxTokens = 1000;
    request.trialId = '../unsafe-mutated-id';
    const recorded = await running;
    assert.equal(prepared, true);
    assert.equal(recorded.status, 'infrastructure_error');
    assert.equal(recorded.outcome.error, 'Stop before native dispatch');
    assert.equal(recorded.task.prompt, task.prompt);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a toy consumer records redacted native evidence without a catalog, server or graders', async () => {
  const { root, recordingsDirectory, inspection, environment } = await setup();
  let calls = 0;
  const fakeSecret = 'sk-offline-fixture-secret-value';
  const metadata = { purpose: 'toy-text-repair', expectedText: 'DO_NOT_INJECT', note: fakeSecret };
  try {
    const runner = piRunner(
      {
        agentSource: root,
        recordingsDirectory,
        model: 'toy-model',
        billing,
        requiredExtensionCommand: 'toy-ready',
        limits: { runtimeMs: 4000, maxTokens: 1000 },
        async prepareEnvironment(context) {
          assert.equal(context.pi.defaults.model, 'toy-model');
          assert.equal(context.limits.runtimeMs, 4000);
          assert.deepEqual(context.task.metadata, metadata);
          return { ...environment(), agentArgs: ['--toy-setup'] };
        },
      },
      {
        inspect: async () => inspection,
        execute: async (request, safeguards) => {
          calls++;
          assert.equal(request.prompt, task.prompt);
          assert.equal(request.executable, 'offline-pi');
          assert.deepEqual(request.args, [
            '--toy-setup',
            '--provider',
            'openai-codex',
            '--model',
            'toy-model',
            '--thinking',
            'xhigh',
          ]);
          assert.deepEqual(safeguards, {
            requiredExtensionCommand: 'toy-ready',
            expectedEndpointHash: hash(endpoint),
          });
          request.onEvent({
            id: 'native-1',
            sequence: 1,
            actor: 'agent',
            kind: 'pi',
            timestamp: '',
            data: { type: 'agent_settled', text: fakeSecret },
          });
          const incremental = await readFile(
            join(recordingsDirectory, 'attempt-1/transcript.jsonl'),
            'utf8',
          );
          assert.match(incremental, /agent_settled/);
          assert.equal(incremental.includes(fakeSecret), false);
          return completed();
        },
      },
    );
    const trial = await runner.run({ ...task, metadata }, { trialId: 'attempt-1' });
    assert.equal(calls, 1);
    assert.equal(trial.trace.complete, true);
    assert.equal(trial.task.version, 1);
    assert.equal(trial.task.metadata?.purpose, 'toy-text-repair');
    assert.equal(trial.task.metadata?.expectedText, 'DO_NOT_INJECT');
    assert.equal('localUrl' in trial.outcome, false);
    assert.equal(JSON.stringify(trial).includes(fakeSecret), false);
    assert.ok(JSON.stringify(trial).includes('[REDACTED_API_KEY]'));
    const directory = join(recordingsDirectory, 'attempt-1');
    assert.equal(trial.metadata.recordingDirectory, directory);
    for (const file of ['grades.json', 'grading-results.json'])
      await assert.rejects(readFile(join(directory, file), 'utf8'), { code: 'ENOENT' });
    assert.ok(
      (await readFile(join(directory, 'integrity.json'), 'utf8')).includes('transcript.jsonl'),
    );
    await assert.rejects(runner.run(task, { trialId: 'attempt-1' }), /EEXIST/);
    await assert.rejects(runner.run(task, { trialId: '../escape' }), /filesystem-safe/);
    assert.equal(calls, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('billing policy admits only verified subscription auth or a positive API dollar limit', async () => {
  const { root, recordingsDirectory, inspection, environment } = await setup();
  const options = {
    agentSource: root,
    recordingsDirectory,
    prepareEnvironment: async () => environment(),
  };
  try {
    for (const amount of [0, -1, Number.POSITIVE_INFINITY])
      assert.throws(() =>
        piRunner({ ...options, billing: { type: 'api', maxEstimatedCostUsd: amount } }),
      );
    const runner = piRunner(
      { ...options, billing },
      {
        inspect: async () => ({
          ...inspection,
          authentication: { provider: 'openai-codex', type: 'api_key' },
        }),
        execute: async () => assert.fail('Unverified subscription auth must not dispatch Pi'),
      },
    );
    await assert.rejects(
      runner.run(task, { trialId: 'wrong-auth' }),
      /verified openai-codex OAuth/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
