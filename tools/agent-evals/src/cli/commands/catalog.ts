import { catalogNames, loadProfile, loadTask } from '../../adapters/evaluation-config.ts';
import type { CommandContext } from '../context.ts';
import { formatDuration, table } from '../output.ts';
import { selectedGraderIds } from '../../adapters/task-graders.ts';
import { harnesses } from '../../adapters/harnesses.ts';

export async function catalogCommand(context: CommandContext): Promise<number> {
  const { repo, request, output } = context;
  if (request.command === 'tasks') {
    const tasks = await Promise.all(
      (await catalogNames(repo, 'tasks')).map((name) => loadTask(repo, name)),
    );
    output.result(
      { tasks },
      `Tasks

${table(
  ['ID', 'KIND', 'SOURCE', 'DESCRIPTION'],
  tasks.map((task) => [
    task.id,
    task.kind,
    task.environment === 'repository'
      ? `repository@${task.repository!.revision.slice(0, 7)}`
      : `fixture:${task.fixture}`,
    task.title ?? task.prompt,
  ]),
)}

Try: pnpm evals experiment repository-ui-copy --dry-run
Add a task: evals/authoring.md`,
    );
    return 0;
  }
  if (request.command === 'profiles') {
    const profiles = await Promise.all(
      (await catalogNames(repo, 'profiles')).map(async (name) => ({
        name,
        ...(await loadProfile(repo, name)),
      })),
    );
    output.result(
      { profiles },
      `Profiles

${table(
  ['NAME', 'HARNESS', 'PI BILLING', 'TOKEN LIMIT', 'DEADLINE', 'API ALLOWANCE', 'GRADER'],
  profiles.map((profile) => [
    profile.name,
    `${profile.harness}/${profile.pi.runtime}`,
    profile.agentBilling,
    profile.maxAgentTokens.toLocaleString('en-US'),
    formatDuration(profile.runtimeMs),
    `$${profile.estimatedApiBudgetUsd}`,
    profile.grader.model,
  ]),
)}

Select one with --profile NAME. API allowances are application estimates.`,
    );
    return 0;
  }
  const tasks = await catalogNames(repo, 'tasks');
  const profiles = await catalogNames(repo, 'profiles');
  const checks = await Promise.allSettled([
    ...tasks.map(async (name) => selectedGraderIds(await loadTask(repo, name))),
    ...profiles.map(async (name) => {
      const profile = await loadProfile(repo, name);
      if (!Object.hasOwn(harnesses, profile.harness))
        throw new Error(`Unknown harness: ${profile.harness}`);
      return profile;
    }),
  ]);
  const errors = checks.flatMap((check, index) =>
    check.status === 'rejected'
      ? [
          {
            configuration: [
              ...tasks.map((name) => `task ${name}`),
              ...profiles.map((name) => `profile ${name}`),
            ][index],
            error:
              check.reason instanceof Error ? check.reason.message : 'Unknown configuration error',
          },
        ]
      : [],
  );
  output.result(
    { valid: errors.length === 0, tasks, profiles, errors },
    errors.length
      ? `Configuration needs attention

${errors
  .map(
    (error) => `${error.configuration}
${error.error}`,
  )
  .join('\n\n')}`
      : `Configuration valid · ${tasks.length} tasks · ${profiles.length} profiles

Task targets and rubrics exist. No models, browser sessions or API calls were started.
Next: pnpm evals doctor --no-grader`,
  );
  return errors.length ? 1 : 0;
}
