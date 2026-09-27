import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { piRunner } from '../src/adapters/pi-runner.ts';
import { hash } from '../src/adapters/file-run-store.ts';
import type { HarnessFactory, HarnessOptions } from '../src/adapters/pi-harness.ts';
import type { TrialLimits } from '../src/index.ts';

const task = { id: 'sample', version: '1', prompt: 'Repair this local file.' };
const profile = {
  id: 'test',
  pi: { model: 'gpt-6-luna' },
  limits: { runtimeMs: 900000, maxTokens: 1500000 },
  agentBilling: 'subscription',
  maxAgentEstimatedCostUsd: null,
};
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'pi-library-runner-'));
  for (const directory of ['tasks', 'profiles'])
    await mkdir(join(root, 'evals', directory), { recursive: true });
  await writeFile(join(root, 'index.html'), 'Original');
  const git = (args: string[]) =>
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git(['init', '-q']);
  git(['add', 'index.html']);
  git([
    '-c',
    'user.name=Offline Test',
    '-c',
    'user.email=test@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-qm',
    'Pinned test source',
  ]);
  const revision = git(['rev-parse', 'HEAD']);
  await writeFile(
    join(root, 'evals/tasks/sample.json'),
    JSON.stringify({
      ...task,
      targetFile: 'index.html',
      expectedText: 'Repaired',
      flowPath: '/',
      repository: { revision },
      acceptance: 'admin-login-retry',
    }),
  );
  await writeFile(join(root, 'evals/profiles/smoke.json'), JSON.stringify(profile));
  return root;
}

test('each Pi trial resolves independent limits before environment preparation and records them', async () => {
  const root = await setup();
  const prepared: TrialLimits[] = [];
  const dispatched: TrialLimits[] = [];
  const prepareHarness: HarnessFactory = async ({ profile }) => {
    prepared.push(profile.limits);
    return {
      expectedModel: { provider: 'openai-codex', id: 'gpt-6-luna', thinkingLevel: 'xhigh' },
      inspection: {},
      manifest: {},
      environment: {
        async prepare() {
          return {
            root,
            workspace: root,
            url: 'http://127.0.0.1:1234',
            env: {},
            agentArgs: [],
            provenance: {},
            async collectArtifacts() {
              return [];
            },
            async cleanup() {},
          };
        },
      },
      agent: {
        async run(request) {
          dispatched.push(request.limits);
          return {
            status: 'completed',
            startedAt: '',
            endedAt: '',
            exitCode: 0,
            signal: null,
            model: null,
            thinkingLevel: null,
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              estimatedCostUsd: null,
              costSource: 'offline',
            },
          };
        },
      },
    };
  };
  try {
    const definitionFile = join(root, 'evals/tasks/sample.json');
    const definition = JSON.parse(await readFile(definitionFile, 'utf8'));
    await writeFile(
      definitionFile,
      JSON.stringify({ ...definition, limits: { maxTurns: 300, maxTokens: 6_000_000 } }),
    );
    const runner = piRunner(
      { sourceRepo: root, agentSource: root, limits: { runtimeMs: 7_200_000, maxTurns: 200 } },
      { prepareHarness },
    );
    const first = await runner.run(
      { ...task, limits: { maxTurns: 400 } },
      { trialId: 'first', limits: { maxTokens: 8_000_000 } },
    );
    await runner.run(task, { trialId: 'second', limits: { runtimeMs: 1000, maxTurns: 2 } });
    const expected = [
      { runtimeMs: 7_200_000, maxTurns: 400, maxTokens: 8_000_000 },
      { runtimeMs: 1000, maxTurns: 2, maxTokens: 6_000_000 },
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
    await assert.rejects(stat(join(root, 'evals/runs/invalid')), { code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('direct Pi runs snapshot caller-owned limits and identity before asynchronous preparation', async () => {
  const root = await setup();
  const options = { sourceRepo: root, agentSource: root, limits: { runtimeMs: 1000 } };
  const authoredTask = { ...task, limits: { maxTurns: 3 } };
  const request = { trialId: 'snapshot', limits: { maxTokens: 100 } };
  let prepared = false;
  const runner = piRunner(options, {
    prepareHarness: async ({ profile }) => {
      prepared = true;
      assert.equal(profile.limits.runtimeMs, 1000);
      assert.equal(profile.limits.maxTurns, 3);
      assert.equal(profile.limits.maxTokens, 100);
      throw new Error('Stop before native dispatch');
    },
  });
  try {
    options.limits.runtimeMs = 2000;
    const running = runner.run(authoredTask, request);
    authoredTask.limits.maxTurns = 30;
    request.limits.maxTokens = 1000;
    request.trialId = '../unsafe-mutated-id';
    await assert.rejects(running, /Stop before native dispatch/);
    assert.equal(prepared, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Pi bridge saves incremental redacted evidence and applies no graders or task metadata to the prompt', async () => {
  const root = await setup();
  let calls = 0;
  const fakeSecret = 'sk-offline-fixture-secret-value';
  const prepareHarness: HarnessFactory = async (options: HarnessOptions) => {
    assert.equal(options.profile.pi.model, 'gpt-6-luna');
    assert.equal(options.profile.limits.runtimeMs, 4000);
    assert.equal(options.profile.limits.maxTokens, 1000);
    assert.equal('metadata' in options.task, false);
    return {
      inspection: { defaults: { model: 'saved-model' }, evaluationModel: { model: 'gpt-6-luna' } },
      manifest: {},
      expectedModel: { provider: 'openai-codex', id: 'gpt-6-luna', thinkingLevel: 'xhigh' },
      environment: {
        async prepare() {
          return {
            root,
            workspace: root,
            url: 'http://127.0.0.1:4321',
            env: {},
            agentArgs: [],
            provenance: {
              recordedContexts: [
                {
                  id: 'context',
                  path: 'AGENTS.md',
                  kind: 'effective-instruction',
                  content: 'Test changes.',
                  sha256: hash('Test changes.'),
                },
              ],
              contextCaptureGaps: [],
            },
            async collectArtifacts() {
              return [];
            },
            async cleanup() {},
          };
        },
      },
      agent: {
        async run(request) {
          calls++;
          assert.equal(request.prompt, task.prompt);
          const event = {
            id: 'native-1',
            sequence: 1,
            actor: 'agent' as const,
            kind: 'pi' as const,
            timestamp: '',
            data: { type: 'agent_settled', text: fakeSecret },
          };
          request.onEvent(event);
          return {
            status: 'completed' as const,
            startedAt: '',
            endedAt: '',
            exitCode: 0,
            signal: null,
            model: { id: 'gpt-6-luna' },
            thinkingLevel: 'xhigh',
            usage: {
              inputTokens: 1,
              outputTokens: 1,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              estimatedCostUsd: null,
              costSource: 'subscription',
            },
          };
        },
      },
    };
  };
  try {
    const runner = piRunner(
      { sourceRepo: root, agentSource: root, limits: { runtimeMs: 4000, maxTokens: 1000 } },
      { prepareHarness },
    );
    const metadata = {
      diagnosis: 'required',
      validation: { required: true, targetFile: 'index.html', expectedText: 'DO_NOT_INJECT' },
    };
    const trial = await runner.run({ ...task, metadata }, { trialId: 'attempt-1' });
    assert.equal(calls, 1);
    assert.equal(trial.trace.complete, true);
    assert.equal(trial.task.metadata?.diagnosis, 'required');
    assert.deepEqual(trial.task.metadata?.validation, metadata.validation);
    assert.equal(JSON.stringify(trial).includes(fakeSecret), false);
    assert.ok(JSON.stringify(trial).includes('[REDACTED_API_KEY]'));
    const directory = join(root, 'evals/runs/attempt-1');
    const transcript = await readFile(join(directory, 'transcript.jsonl'), 'utf8');
    assert.equal(transcript.includes(fakeSecret), false);
    assert.match(transcript, /agent_settled/);
    assert.equal(trial.metadata.recordingDirectory, directory);
    for (const file of ['grades.json', 'grading-results.json'])
      await assert.rejects(readFile(join(directory, file), 'utf8'), { code: 'ENOENT' });
    assert.ok(
      (await readFile(join(directory, 'integrity.json'), 'utf8')).includes('transcript.jsonl'),
    );
    await assert.rejects(runner.run(task, { trialId: 'attempt-1' }), /EEXIST/);
    assert.equal(calls, 1);
    await assert.rejects(
      runner.run({ ...task, prompt: 'Different hidden task' }, { trialId: 'attempt-2' }),
      /must match/,
    );
    await assert.rejects(runner.run(task, { trialId: '../escape' }), /filesystem-safe/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
