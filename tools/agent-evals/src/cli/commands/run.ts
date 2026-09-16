import { createTrialPlan } from '../live-plan.ts';
import { timestampId, type CommandContext } from '../context.ts';
import { formatDuration, trialSummary } from '../output.ts';
import { gradingCost } from '../grading-view.ts';
import { executeTrial, prepareExecution } from '../trial-execution.ts';

export async function runCommand(context: CommandContext): Promise<number> {
  const plan = await createTrialPlan(context);
  if (context.request.values['dry-run']) {
    context.output.result(
      {
        dryRun: true,
        ...plan,
        budget: { limitUsd: plan.budget.limitUsd, reservedEstimateUsd: plan.budget.reservedUsd },
      },
      `Ready to run · ${plan.task.id} · instruction ${plan.variant}

${plan.task.prompt}

Agent profile source: ${plan.agentSource}
Harness: ${plan.profile.harness}/${plan.profile.pi.runtime}
Task source: ${plan.task.environment === 'repository' ? `repository@${plan.task.repository!.revision}` : `fixture:${plan.task.fixture}`}
Bounds: ${plan.profile.maxAgentTokens.toLocaleString('en-US')} observed tokens · ${formatDuration(plan.profile.runtimeMs)}
API grader: ${plan.useGrader ? plan.profile.grader.model : 'disabled (opt in with --semantic)'}
API reservation: $${plan.budget.reservedUsd.toFixed(6)} of $${plan.budget.limitUsd}

Dry run only. No Pi, API or browser calls were made.
Next: remove --dry-run to start this configuration.`,
    );
    return 0;
  }
  const setup = await prepareExecution(context, plan);
  const result = await executeTrial(
    context,
    plan,
    setup,
    `trial-${plan.task.id}-${plan.variant}-${timestampId()}`,
  );
  const apiCost = gradingCost(result.gradingResults);
  context.output.result(
    {
      id: result.id,
      status: result.evidence.agent.status,
      grades: result.grades,
      agentUsage: result.evidence.agent.usage,
      graderCostUsd: apiCost,
      report: result.report,
    },
    trialSummary(
      result.evidence,
      result.grades,
      result.report,
      plan.useGrader ? apiCost : 'not-run',
    ),
  );
  return result.evidence.agent.status !== 'completed' ||
    result.grades.some((grade) => ['fail', 'unknown'].includes(grade.verdict))
    ? 2
    : 0;
}
