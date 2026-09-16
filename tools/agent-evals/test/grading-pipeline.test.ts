import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTaskGraders,
  graderRegistry,
  selectedModelGraderCount,
  type GraderRegistry,
} from '../src/adapters/task-graders.ts';
import { gradeEvidence, flattenGrades } from '../src/application/grade-evidence.ts';
import { runTrial } from '../src/application/run-trial.ts';
import { gradingCost } from '../src/cli/grading-view.ts';
import { invariantMismatches } from '../src/domain/comparison.ts';
import type { AgentResult, Artifact, Grader, Task, TrialEvidence } from '../src/domain/types.ts';

const task: Task = {
  id: 'scoped-docs',
  version: '1',
  kind: 'docs',
  prompt: 'Document local startup.',
  targetFile: 'README.md',
  expectedText: 'pnpm dev',
  flowPath: '/',
  acceptance: 'local-development-docs',
  allowedChangedPaths: ['README.md'],
  graders: ['target-outcome', 'acceptance-checks', 'diff-scope'],
};
const artifact = (id: string, content: string, path = 'README.md'): Artifact => ({
  id,
  path,
  content,
  sha256: 'a'.repeat(64),
  observedBy: 'evaluator',
});
const agent: AgentResult = {
  status: 'completed',
  startedAt: '2026-09-16T10:00:00Z',
  endedAt: '2026-09-16T10:00:01Z',
  exitCode: 0,
  signal: null,
  model: null,
  thinkingLevel: null,
  events: [],
  usage: {
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    estimatedCostUsd: 0,
    costSource: 'offline',
  },
};

test('one additional task-selected grader survives live execution and saved-evidence regrading', async () => {
  const saved = new Map<string, unknown>();
  const phases: string[] = [];
  const result = await runTrial(
    {
      id: 'offline-proof',
      task,
      variant: 'enabled',
      runtimeMs: 100,
      maxTokens: 100,
      maxEstimatedCostUsd: null,
      expectedModel: { provider: 'fake', id: 'fake', thinkingLevel: 'none' },
      manifest: {},
    },
    {
      environment: {
        async prepare() {
          return {
            root: '/unused',
            workspace: '/unused',
            url: 'http://127.0.0.1:1',
            env: {},
            agentArgs: [],
            provenance: {},
            async collectArtifacts() {
              return [artifact('target', 'Existing documentation')];
            },
            async finalize() {
              phases.push('final-observation');
              return {
                artifacts: [artifact('target', 'Start with pnpm dev')],
                patch: artifact(
                  'patch',
                  'README.md and unrelated.txt were changed',
                  'changes.patch',
                ),
                changedFiles: ['README.md', 'unrelated.txt'],
                checks: [
                  {
                    id: 'acceptance-local-development-docs',
                    actor: 'evaluator' as const,
                    command: ['node', 'check.mjs'],
                    exitCode: 0,
                    stdout: 'Passed',
                    stderr: '',
                    status: 'pass' as const,
                  },
                ],
              };
            },
            async cleanup() {
              phases.push('cleanup');
            },
          };
        },
      },
      agent: {
        async run() {
          return structuredClone(agent);
        },
      },
      graders: createTaskGraders(task),
      store: {
        async save(name, value) {
          saved.set(name, structuredClone(value));
        },
        append() {},
      },
    },
  );
  assert.deepEqual(phases, ['final-observation', 'cleanup']);
  assert.deepEqual(
    result.grades.map(({ grader, verdict }) => [grader, verdict]),
    [
      ['target-outcome', 'pass'],
      ['acceptance-checks', 'pass'],
      ['diff-scope', 'fail'],
    ],
  );
  const savedEvidence = saved.get('evidence.json') as TrialEvidence;
  assert.equal(savedEvidence.beforeArtifacts?.[0].content, 'Existing documentation');
  assert.equal(savedEvidence.patch?.id, 'patch');
  const regraded = await gradeEvidence(savedEvidence, createTaskGraders(savedEvidence.task));
  assert.deepEqual(flattenGrades(regraded), result.grades);
  assert.deepEqual(saved.get('grading-results.json'), result.gradingResults);
  assert.ok(result.gradingResults.every((grading) => grading.metering === 'none'));

  const otherTask = { ...task, graders: ['target-outcome'] };
  assert.deepEqual(
    flattenGrades(
      await gradeEvidence({ ...savedEvidence, task: otherTask }, createTaskGraders(otherTask)),
    ).map((grade) => grade.grader),
    ['target-outcome'],
  );
});

test('a failing grader preserves independent results and identifies its own failure', async () => {
  const evidence = {
    task,
    artifacts: [],
    events: [],
    agent,
    variant: 'enabled',
    localUrl: '',
  } satisfies TrialEvidence;
  const broken: Grader = {
    id: 'broken',
    version: '7',
    metering: 'semantic-api',
    async grade() {
      throw new Error('Private adapter error');
    },
  };
  const results = await gradeEvidence(evidence, [
    broken,
    ...createTaskGraders({ ...task, graders: ['diff-scope'] }),
  ]);
  assert.equal(results[0].status, 'grader_error');
  assert.equal(results[0].grader, 'broken');
  assert.equal(results[0].metering, 'semantic-api');
  assert.equal(results[0].grades[0].reason, 'Grader error');
  assert.equal(gradingCost(results), null);
  assert.equal(results[1].status, 'completed');
  assert.equal(results[1].grades[0].verdict, 'unknown');
});

test('cancellation before grading proves zero API usage and preserves selected criteria', async () => {
  const evidence = {
    task,
    artifacts: [],
    events: [],
    agent,
    variant: 'enabled',
    localUrl: '',
  } satisfies TrialEvidence;
  const controller = new AbortController();
  const criteria = { model: 'offline-model', rubricHash: 'known-rubric' };
  let calls = 0;
  const grader: Grader = {
    id: 'model-grader',
    version: '1',
    metering: 'semantic-api',
    criteria,
    async grade() {
      calls++;
      return {
        grader: 'model-grader',
        version: '1',
        status: 'completed',
        grades: [],
        usage: { ...agent.usage, estimatedCostUsd: 0.000816 },
      };
    },
  };
  const completed = await gradeEvidence(evidence, [grader]);
  controller.abort();
  const cancelled = await gradeEvidence(evidence, [grader], controller.signal);
  assert.equal(calls, 1);
  assert.equal(cancelled[0].status, 'cancelled');
  assert.equal(cancelled[0].grades[0].verdict, 'unknown');
  assert.equal(cancelled[0].usage?.estimatedCostUsd, 0);
  assert.match(cancelled[0].usage!.costSource, /before grader execution/);
  assert.equal(gradingCost([...completed, ...cancelled]), 0.000816);
  assert.deepEqual(invariantMismatches(completed[0].criteria, cancelled[0].criteria), []);
});

test('cancellation after entering a model grader keeps missing API usage unknown', async () => {
  const evidence = {
    task,
    artifacts: [],
    events: [],
    agent,
    variant: 'enabled',
    localUrl: '',
  } satisfies TrialEvidence;
  const controller = new AbortController();
  const result = await gradeEvidence(
    evidence,
    [
      {
        id: 'interrupted',
        version: '1',
        metering: 'semantic-api',
        criteria: { model: 'known-model' },
        async grade() {
          controller.abort();
          throw new Error('No usage response');
        },
      },
    ],
    controller.signal,
  );
  assert.equal(result[0].status, 'cancelled');
  assert.equal(result[0].usage, undefined);
  assert.equal(gradingCost(result), null);
  assert.deepEqual(result[0].criteria, { model: 'known-model' });
});

test('registered semantic grader exposes criteria before cancellation without model dispatch', async () => {
  const evidence = {
    task,
    artifacts: [],
    events: [],
    agent,
    variant: 'enabled',
    localUrl: '',
  } satisfies TrialEvidence;
  const selected = createTaskGraders(
    { ...task, graders: ['semantic-task-clarity'] },
    {
      semantic: {
        key: 'unused-offline-key',
        rubric: 'Offline rubric',
        config: {
          model: 'test-model',
          maxInputChars: 1000,
          maxOutputTokens: 100,
          timeoutMs: 1000,
          inputPerMillion: 1,
          outputPerMillion: 1,
          pricingSource: 'test',
        },
      },
    },
  );
  const result = await gradeEvidence(evidence, selected, AbortSignal.abort());
  assert.equal(result[0].criteria?.model, 'test-model');
  assert.match(String(result[0].criteria?.rubricHash), /^[a-f0-9]{64}$/);
  assert.deepEqual(result[0].criteria, selected[0].criteria);
  assert.equal(gradingCost(result), 0);
  const mechanical = await gradeEvidence(evidence, createTaskGraders(task), AbortSignal.abort());
  assert.ok(mechanical.every((item) => item.usage === undefined));
  assert.equal(gradingCost(mechanical), 0);
});

test('unknown and duplicate selected graders fail before execution', () => {
  assert.throws(
    () => createTaskGraders({ ...task, graders: ['unregistered'] }),
    /Unknown task grader/,
  );
  assert.throws(
    () => createTaskGraders({ ...task, graders: ['diff-scope', 'diff-scope'] }),
    /unique/,
  );
});

test('an injected grader is selected identically for live and saved evidence without changing dispatch', async () => {
  const registry: GraderRegistry = {
    ...graderRegistry,
    'forbidden-word': {
      metering: 'none',
      create: () => ({
        id: 'forbidden-word',
        version: '1',
        async grade(evidence) {
          return {
            grader: 'forbidden-word',
            version: '1',
            status: 'completed',
            grades: [
              {
                grader: 'forbidden-word',
                version: '1',
                verdict: evidence.artifacts.some((file) => file.content.includes('TODO'))
                  ? 'fail'
                  : 'pass',
                reason: 'Captured target must not retain TODO placeholders',
                evidenceRefs: evidence.artifacts.map((file) => file.id),
              },
            ],
          };
        },
      }),
    },
  };
  const selected = { ...task, graders: ['forbidden-word'] };
  const evidence = {
    task: selected,
    artifacts: [artifact('target', 'TODO: startup')],
    events: [],
    agent,
    variant: 'enabled',
    localUrl: '',
  } satisfies TrialEvidence;
  const first = await gradeEvidence(evidence, createTaskGraders(selected, { registry }));
  const regrade = await gradeEvidence(
    structuredClone(evidence),
    createTaskGraders(selected, { registry }),
  );
  assert.deepEqual(first, regrade);
  assert.equal(first[0].grades[0].verdict, 'fail');
});

test('a second model grader shares model admission through registry metadata', () => {
  const registry: GraderRegistry = {
    ...graderRegistry,
    'semantic-scope': {
      metering: 'semantic-api',
      create() {
        throw new Error('Disabled model graders must not be constructed');
      },
    },
  };
  const selected = { ...task, graders: ['semantic-task-clarity', 'semantic-scope', 'diff-scope'] };
  assert.equal(selectedModelGraderCount(selected, registry), 2);
  assert.deepEqual(
    createTaskGraders(selected, { registry }).map((grader) => grader.id),
    ['diff-scope'],
  );
});
