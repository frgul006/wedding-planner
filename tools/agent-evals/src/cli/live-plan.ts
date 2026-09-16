import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  loadProfile,
  loadTask,
  type EvaluationProfile,
  type TaskDefinition,
} from '../adapters/evaluation-config.ts';
import { readSavedRun, resolveRun } from '../adapters/saved-runs.ts';
import { defaultEnvFile } from '../adapters/secrets.ts';
import { EstimatedBudget, estimateCost } from '../domain/budget.ts';
import { selectedModelGraderCount } from '../adapters/task-graders.ts';
import { harnesses } from '../adapters/harnesses.ts';
import type { CommandContext } from './context.ts';

export interface ManualRetry {
  id: string;
  directory: string;
  reason: string;
}

export interface TrialPlan {
  task: TaskDefinition;
  profile: EvaluationProfile;
  variant: 'enabled' | 'disabled';
  fixtureDirectory: string;
  rubric: string;
  envFile: string;
  useGrader: boolean;
  budget: EstimatedBudget;
  retryOf: ManualRetry | null;
  agentSource: string;
}

export function profileOverrides(context: CommandContext) {
  const values = context.request.values;
  return {
    budgetUsd: values['budget-usd'],
    graderModel: values['grader-model'],
    graderInputPrice: values['grader-input-price'],
    graderOutputPrice: values['grader-output-price'],
  };
}

export function graderEnvFile(context: CommandContext): string {
  const requested = context.request.values['grader-env-file'];
  return requested ? path.resolve(context.callerCwd, requested) : defaultEnvFile(context.repo);
}

export function agentSource(context: CommandContext): string {
  const requested = context.request.values['agent-source'];
  return requested
    ? path.resolve(context.callerCwd, requested)
    : path.dirname(defaultEnvFile(context.repo));
}

export function reserveBudget(
  profile: EvaluationProfile,
  useGrader: boolean,
  includeAgent: boolean,
  modelGraderCount = 1,
): EstimatedBudget {
  const budget = new EstimatedBudget(profile.estimatedApiBudgetUsd);
  if (useGrader)
    budget.reserve(
      modelGraderCount *
        estimateCost(profile.grader.maxInputChars, profile.grader.maxOutputTokens, {
          inputPerMillion: profile.grader.inputPerMillion,
          outputPerMillion: profile.grader.outputPerMillion,
          source: profile.grader.pricingSource,
        }),
    );
  if (includeAgent && profile.agentBilling === 'api')
    budget.reserve(profile.maxAgentEstimatedCostUsd!);
  return budget;
}

/** Validate all local inputs and admission controls before credentials or network work. */
export async function createTrialPlan(context: CommandContext): Promise<TrialPlan> {
  const { repo, callerCwd, request } = context;
  const taskName = request.args[0] ?? request.values.task ?? 'repository-ui-copy';
  const [task, profile] = await Promise.all([
    loadTask(repo, taskName),
    loadProfile(repo, request.values.profile, profileOverrides(context)),
  ]);
  const modelGraderCount = selectedModelGraderCount(task);
  if (request.values.semantic && modelGraderCount === 0)
    throw new Error('This task has no configured API graders; omit --semantic.');
  const useGrader = Boolean(request.values.semantic) && modelGraderCount > 0;
  if (!Object.hasOwn(harnesses, profile.harness))
    throw new Error(
      `Unknown harness "${profile.harness}". Registered: ${Object.keys(harnesses).join(', ')}`,
    );
  const budget = reserveBudget(profile, useGrader, true, modelGraderCount);
  let retryOf: ManualRetry | null = null;
  if (request.values['retry-of']) {
    const previous = await readSavedRun(
      await resolveRun(repo, request.values['retry-of'], callerCwd),
    );
    retryOf = {
      id: previous.id,
      directory: previous.directory,
      reason:
        'Explicit manual retry; original evidence retained. Changed harness/profile conditions do not form a controlled comparison.',
    };
  }
  return {
    task,
    profile,
    useGrader,
    budget,
    retryOf,
    variant: request.values.variant === 'disabled' ? 'disabled' : 'enabled',
    fixtureDirectory:
      task.environment === 'repository' ? repo : path.join(repo, 'evals/fixtures', task.fixture),
    rubric: await readFile(path.join(repo, 'evals/rubrics', `${task.rubric}.md`), 'utf8'),
    envFile: graderEnvFile(context),
    agentSource: agentSource(context),
  };
}
