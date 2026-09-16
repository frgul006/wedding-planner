import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createHarness, type HarnessOptions } from '../src/adapters/harnesses.ts';
import { loadProfile, loadTask } from '../src/adapters/evaluation-config.ts';
import { readSavedRun } from '../src/adapters/saved-runs.ts';
import { executeTrial } from '../src/cli/trial-execution.ts';
import { reserveBudget } from '../src/cli/live-plan.ts';
import { ConsoleOutput } from '../src/cli/output.ts';
import { parseCommand } from '../src/cli/arguments.ts';

test('a second harness registration runs through the unchanged trial command seam and seals its evidence', async () => {
  const repo = fileURLToPath(new URL('../../../', import.meta.url));
  const profile = await loadProfile(repo);
  const task = { ...(await loadTask(repo, 'ui-copy')), graders: ['target-outcome'] };
  const options: HarnessOptions = {
    sourceRepo: repo,
    agentSource: repo,
    task,
    profile,
    rubric: '',
  };
  let dispatched = 0;
  const harness = await createHarness('fake-second', options, {
    async 'fake-second'(received) {
      assert.equal(received, options);
      return {
        expectedModel: { provider: 'fake', id: 'offline', thinkingLevel: 'none' },
        inspection: { adapter: 'fake-second' },
        description: 'Offline second adapter',
        manifest: { comparisonEligible: true, invariants: { fixtureHash: 'same' } },
        environment: {
          async prepare() {
            return {
              root: '/fake',
              workspace: '/fake/workspace',
              url: 'http://127.0.0.1:1234',
              env: {},
              agentArgs: [],
              provenance: {},
              async cleanup() {},
              async collectArtifacts() {
                return [
                  {
                    id: 'a-target',
                    path: task.targetFile,
                    content: task.expectedText,
                    sha256: 'a'.repeat(64),
                    observedBy: 'evaluator' as const,
                  },
                ];
              },
            };
          },
        },
        agent: {
          async run() {
            dispatched++;
            return {
              status: 'completed' as const,
              startedAt: '',
              endedAt: '',
              exitCode: 0,
              signal: null,
              model: { provider: 'fake', id: 'offline' },
              thinkingLevel: 'none',
              events: [],
              usage: {
                inputTokens: 0,
                outputTokens: 0,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                estimatedCostUsd: 0,
                costSource: 'Offline fake',
              },
            };
          },
        },
      };
    },
  });
  const directory = await mkdtemp(join(tmpdir(), 'eval-second-harness-'));
  try {
    const context = {
      repo: directory,
      callerCwd: directory,
      request: parseCommand(['run', 'ui-copy']),
      output: new ConsoleOutput(true),
    };
    const plan = {
      task,
      profile,
      variant: 'enabled' as const,
      fixtureDirectory: repo,
      rubric: '',
      envFile: '/unused',
      agentSource: repo,
      useGrader: false,
      budget: reserveBudget(profile, false, true),
      retryOf: null,
    };
    const result = await executeTrial(
      context,
      plan,
      { key: '', availability: null, harness },
      'fake-trial',
    );
    const saved = await readSavedRun(result.directory);
    assert.equal(dispatched, 1);
    assert.equal(saved.evidence.agent.model?.provider, 'fake');
    assert.deepEqual(
      saved.original.grades.map((grade) => grade.grader),
      ['target-outcome'],
    );
    assert.equal(saved.original.grades[0].verdict, 'pass');
    assert.throws(() => createHarness('toString', options, {}), /Unknown harness/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
