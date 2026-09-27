import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { piRunner } from '../src/adapters/pi-runner.ts';
import { hash } from '../src/adapters/file-run-store.ts';
import type { HarnessFactory } from '../src/adapters/harnesses.ts';

const task = { id: 'sample', version: '1', prompt: 'Repair this synthetic file.' };
const profile = {
  id: 'test',
  harness: 'pi',
  pi: { runtime: 'native', model: 'gpt-6-luna' },
  concurrency: 1,
  runtimeMs: 900000,
  maxAgentTokens: 1500000,
  agentBilling: 'subscription',
  maxAgentEstimatedCostUsd: null,
  estimatedApiBudgetUsd: 1,
  agentRetries: 0,
  grader: {
    model: 'unused',
    reasoningEffort: 'none',
    maxOutputTokens: 800,
    maxInputChars: 18000,
    timeoutMs: 20000,
    maxRetries: 0,
    inputPerMillion: 0,
    outputPerMillion: 0,
    pricingSource: 'unused',
    pricingCheckedOn: '2026-09-27',
  },
};
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'pi-library-runner-'));
  for (const directory of ['tasks', 'profiles', 'rubrics', 'fixtures/wedding-copy'])
    await mkdir(join(root, 'evals', directory), { recursive: true });
  await writeFile(
    join(root, 'evals/tasks/sample.json'),
    JSON.stringify({
      ...task,
      kind: 'ui',
      targetFile: 'index.html',
      expectedText: 'Repaired',
      flowPath: '/',
      fixture: 'wedding-copy',
      rubric: 'test',
    }),
  );
  await writeFile(join(root, 'evals/profiles/smoke.json'), JSON.stringify(profile));
  await writeFile(join(root, 'evals/rubrics/test.md'), 'Unused semantic rubric');
  await writeFile(join(root, 'evals/fixtures/wedding-copy/index.html'), 'Original');
  return root;
}

test('Pi bridge saves incremental redacted evidence and applies no graders or task metadata to the prompt', async () => {
  const root = await setup();
  let calls = 0;
  const fakeSecret = 'sk-offline-fixture-secret-value';
  const prepareHarness: HarnessFactory = async (options) => {
    assert.equal(options.profile.pi.model, 'gpt-6-luna');
    assert.equal(options.profile.runtimeMs, 4000);
    assert.equal(options.profile.maxAgentTokens, 1000);
    assert.equal('metadata' in options.task, false);
    return {
      inspection: { defaults: { model: 'saved-model' }, evaluationModel: { model: 'gpt-6-luna' } },
      manifest: { invariants: { model: { id: 'gpt-6-luna' } } },
      expectedModel: { provider: 'openai-codex', id: 'gpt-6-luna', thinkingLevel: 'xhigh' },
      description: 'Offline fake',
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
          request.onEvent?.(event);
          return {
            status: 'completed' as const,
            startedAt: '',
            endedAt: '',
            exitCode: 0,
            signal: null,
            events: [event],
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
      { sourceRepo: root, agentSource: root, runtimeMs: 4000, maxTokens: 1000 },
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
    assert.deepEqual(
      JSON.parse(await readFile(join(directory, 'grading-results.json'), 'utf8')),
      [],
    );
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
