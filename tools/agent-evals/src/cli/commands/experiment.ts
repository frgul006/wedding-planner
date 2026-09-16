import path from 'node:path';
import { planExperiment, runExperiment } from '../../application/run-experiment.ts';
import { FileRunStore } from '../../adapters/file-run-store.ts';
import {
  buildReviewBundle,
  renderReviewBundle,
  writeReviewBundle,
} from '../../adapters/review-bundle.ts';
import { verifyIntegrity } from '../../adapters/saved-runs.ts';
import { compareTrials } from '../../domain/comparison.ts';
import { timestampId, type CommandContext } from '../context.ts';
import { createTrialPlan } from '../live-plan.ts';
import { directApiCost } from '../grading-view.ts';
import { executeTrial, prepareExecution, type ExecutedTrial } from '../trial-execution.ts';

export async function experimentCommand(context: CommandContext): Promise<number> {
  const plan = await createTrialPlan(context);
  const experiment = planExperiment(
    Number(context.request.values.pairs ?? 1),
    plan.budget.reservedUsd,
    plan.budget.limitUsd,
  );
  if (context.request.values['dry-run']) {
    context.output.result(
      {
        dryRun: true,
        task: plan.task,
        profile: plan.profile,
        agentSource: plan.agentSource,
        useGrader: plan.useGrader,
        ...experiment,
      },
      `Ready: ${plan.task.id} · ${experiment.steps.length / 2} matched pair(s)

${plan.task.prompt}

Schedule: ${experiment.steps.map((step) => `${step.pair}:${step.variant}`).join(' → ')}
Harness: ${plan.profile.harness}/${plan.profile.pi.runtime}
Task source: ${plan.task.environment === 'repository' ? `repository@${plan.task.repository!.revision}` : `fixture:${plan.task.fixture}`}
Agent profile source: ${plan.agentSource}
API grader: ${plan.useGrader ? plan.profile.grader.model : 'disabled (opt in with --semantic)'}
Whole experiment reservation: $${experiment.budget.reservedEstimateUsd.toFixed(6)} of $${experiment.budget.limitUsd}

Dry run only. No Pi, API or browser calls were made.
Next: remove --dry-run. All attempts, comparisons and a shareable review bundle will be retained.`,
    );
    return 0;
  }
  const id = `experiment-${plan.task.id}-${timestampId()}`;
  const setup = await prepareExecution(context, plan);
  const store = new FileRunStore(path.join(context.repo, 'evals/runs', id), [setup.key]);
  await store.initialize();
  const attempts = await runExperiment(
    experiment,
    (step) =>
      executeTrial(
        context,
        { ...plan, variant: step.variant },
        setup,
        `${id}-${step.index}-${step.variant}`,
        { id, pair: step.pair, aggregateApiAllowanceUsd: experiment.budget.limitUsd },
      ),
    async (current) => {
      await store.save('experiment.json', {
        id,
        task: plan.task.id,
        ...experiment,
        attempts: current.map((attempt) =>
          attempt.status === 'recorded'
            ? {
                step: attempt.step,
                status: attempt.status,
                id: attempt.result.id,
                directory: attempt.result.directory,
                agentStatus: attempt.result.evidence.agent.status,
              }
            : attempt,
        ),
      });
    },
    context.signal,
  );
  const recorded = attempts.flatMap((attempt) => (attempt.status === 'recorded' ? [attempt] : []));
  const comparisons = Array.from({ length: experiment.steps.length / 2 }, (_, index) => {
    const pair = recorded.filter((attempt) => attempt.step.pair === index + 1);
    const comparable = (trial: ExecutedTrial) => ({
      variant: trial.evidence.variant,
      invariants: trial.manifest.invariants,
      comparisonEligible: trial.manifest.comparisonEligible === true,
      grading: trial.gradingResults.map((result) => ({
        grader: result.grader,
        version: result.version,
        criteria: result.criteria,
      })),
    });
    const result =
      pair.length === 2
        ? compareTrials(comparable(pair[0].result), comparable(pair[1].result))
        : { eligible: false, reason: 'Both trial records are required.', mismatches: [] };
    return { pair: index + 1, ...result };
  });
  await store.save('comparison.json', comparisons);
  const reviews = await Promise.all(
    recorded.map(async ({ result }) => ({
      ...result,
      integrityHash: await verifyIntegrity(result.directory),
    })),
  );
  const hasApiCalls = plan.useGrader || plan.profile.agentBilling === 'api';
  const budget = {
    ...experiment.budget,
    observedApiEstimateUsd:
      recorded.length !== attempts.length && hasApiCalls
        ? null
        : directApiCost(reviews, plan.profile.agentBilling),
  };
  const bundle = buildReviewBundle(
    id,
    reviews,
    comparisons.map((pair) => ({
      pair: pair.pair,
      eligible: pair.eligible,
      mismatchFields: pair.mismatches.map((item) => item.path),
    })),
    budget,
    attempts.length - recorded.length,
  );
  const reviewDirectory = path.join(store.directory, 'review');
  await writeReviewBundle(reviewDirectory, bundle);
  await store.save(
    'report.md',
    renderReviewBundle(bundle).replace('(bundle.json)', '(review/bundle.json)'),
  );
  await store.seal(['experiment.json', 'comparison.json', 'report.md']);
  const completed =
    recorded.length === attempts.length &&
    recorded.every(
      ({ result }) =>
        result.evidence.agent.status === 'completed' &&
        result.gradingResults.every((grading) => grading.status === 'completed'),
    ) &&
    comparisons.every((pair) => pair.eligible);
  context.output.result(
    {
      id,
      status: completed ? 'completed' : 'incomplete',
      budget,
      comparisons,
      trials: bundle.trials,
      report: path.join(store.directory, 'report.md'),
      reviewDirectory,
    },
    `Experiment ${completed ? 'completed' : 'incomplete'} · ${plan.task.id}

${recorded.length}/${attempts.length} trial records retained · ${comparisons.filter((pair) => pair.eligible).length}/${comparisons.length} matched pairs
API reservation: $${experiment.budget.reservedEstimateUsd.toFixed(6)} of $${experiment.budget.limitUsd}
Observed direct API estimate: ${budget.observedApiEstimateUsd === null ? 'unknown' : `$${budget.observedApiEstimateUsd.toFixed(6)}`}

Report: ${path.join(store.directory, 'report.md')}
Shareable review bundle: ${reviewDirectory}
Failed judgments remain observations; inspect the report before drawing conclusions.`,
  );
  return completed ? 0 : 2;
}
