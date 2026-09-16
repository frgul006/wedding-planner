import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { runTrial } from '../application/run-trial.ts';
import { checkGraderModel } from '../adapters/ai-sdk-grader.ts';
import { FileRunStore, hash } from '../adapters/file-run-store.ts';
import { createHarness } from '../adapters/harnesses.ts';
import { loadGraderKey } from '../adapters/secrets.ts';
import { createTaskGraders } from '../adapters/task-graders.ts';
import { observeSkills } from '../domain/deterministic-graders.ts';
import { renderReport } from '../domain/report.ts';
import type { CommandContext } from './context.ts';
import { gradingCost, semanticView } from './grading-view.ts';
import type { TrialPlan } from './live-plan.ts';

/** Freeze the native profile once for a run or an entire matched experiment. */
export async function prepareExecution(context: CommandContext, plan: TrialPlan) {
  const key = plan.useGrader ? await loadGraderKey(plan.envFile) : '';
  const availability = key
    ? await checkGraderModel(key, plan.profile.grader.model, context.signal)
    : null;
  const harness = await context.output.during('Preparing the selected agent harness…', () =>
    createHarness(plan.profile.harness, {
      sourceRepo: context.repo,
      agentSource: plan.agentSource,
      task: plan.task,
      profile: plan.profile,
      rubric: plan.rubric,
      signal: context.signal,
    }),
  );
  context.output.progress(harness.description);
  return { key, availability, harness };
}
export type TrialExecutionSetup = Awaited<ReturnType<typeof prepareExecution>>;

/** Run one trial without owning CLI dispatch or an experiment's stopping policy. */
export async function executeTrial(
  context: CommandContext,
  plan: TrialPlan,
  setup: TrialExecutionSetup,
  id: string,
  experiment?: { id: string; pair: number; aggregateApiAllowanceUsd: number },
) {
  const { harness, key } = setup;
  const store = new FileRunStore(path.join(context.repo, 'evals/runs', id), [key]);
  await store.initialize();
  await store.save('inspection.json', harness.inspection);
  const result = await runTrial(
    {
      id,
      signal: context.signal,
      task: plan.task,
      variant: plan.variant,
      runtimeMs: plan.profile.runtimeMs,
      maxTokens: plan.profile.maxAgentTokens,
      maxEstimatedCostUsd: plan.profile.maxAgentEstimatedCostUsd,
      expectedModel: harness.expectedModel,
      manifest: {
        ...harness.manifest,
        variant: plan.variant,
        profile: plan.profile,
        experiment,
        retryOf: plan.retryOf,
        budget: {
          appliesTo:
            plan.profile.agentBilling === 'subscription'
              ? 'direct API calls only; verified subscription Pi excluded'
              : 'Pi and grader API calls',
          limitUsd: plan.budget.limitUsd,
          reservedEstimateUsd: plan.budget.reservedUsd,
          agentBilling: plan.profile.agentBilling,
          concurrency: 1,
          providerEnforced: false,
        },
        graderAvailability: setup.availability,
        rubric: { id: plan.task.rubric, version: '1', sha256: hash(plan.rubric) },
        harnessVersion: '0.3.0',
      },
    },
    {
      environment: {
        prepare: (...args) =>
          context.output.during('Preparing isolated task environment…', () =>
            harness.environment.prepare(...args),
          ),
      },
      agent: {
        run: (request) => context.output.during(`Running ${id}…`, () => harness.agent.run(request)),
      },
      graders: createTaskGraders(
        plan.task,
        key ? { semantic: { key, config: plan.profile.grader, rubric: plan.rubric } } : {},
      ),
      store,
    },
  );
  const semantic = semanticView(result.gradingResults);
  if (semantic) await store.save('semantic.json', semantic);
  const manifest: typeof result.manifest & Record<string, unknown> = {
    ...result.manifest,
    graderUsage: semantic?.usage ?? null,
    graderStatus: semantic?.status ?? 'not-run',
    gradingCostUsd: gradingCost(result.gradingResults),
  };
  await store.save('manifest.json', manifest);
  await store.save('skills.json', observeSkills(result.evidence));
  const files = await readdir(store.directory);
  await store.save(
    'report.md',
    renderReport(id, result.evidence, result.grades, semantic, {
      availableFiles: files,
      gradingResults: result.gradingResults,
    }),
  );
  await store.seal([
    'manifest.json',
    'evidence.json',
    'grades.json',
    'grading-results.json',
    'inspection.json',
    'report.md',
    'transcript.jsonl',
    'skills.json',
    ...(files.includes('environment.json') ? ['environment.json'] : []),
    ...(semantic ? ['semantic.json'] : []),
  ]);
  return {
    ...result,
    manifest,
    id,
    directory: store.directory,
    report: path.join(store.directory, 'report.md'),
  };
}
export type ExecutedTrial = Awaited<ReturnType<typeof executeTrial>>;
