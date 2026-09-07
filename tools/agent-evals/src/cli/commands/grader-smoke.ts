import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { AiSdkRubricGrader, checkGraderModel } from '../../adapters/ai-sdk-grader.ts';
import { loadProfile, loadTask } from '../../adapters/evaluation-config.ts';
import { FileRunStore, hash } from '../../adapters/file-run-store.ts';
import { loadGraderKey } from '../../adapters/secrets.ts';
import { renderReport } from '../../domain/report.ts';
import type { TrialEvidence } from '../../domain/types.ts';
import { timestampId, type CommandContext } from '../context.ts';
import { graderEnvFile, profileOverrides, reserveBudget } from '../live-plan.ts';
import { formatCost, gradeLines } from '../output.ts';

export async function graderSmokeCommand(context: CommandContext): Promise<number> {
  const { repo, request, output } = context;
  const profile = await loadProfile(repo, request.values.profile, profileOverrides(context));
  const budget = reserveBudget(profile, true, false);
  const task = await loadTask(repo, 'ui-copy');
  const rubric = await readFile(path.join(repo, 'evals/rubrics', `${task.rubric}.md`), 'utf8');
  const key = await loadGraderKey(graderEnvFile(context));
  await checkGraderModel(key, profile.grader.model, context.signal);
  const id = `grader-smoke-${timestampId()}`;
  const store = new FileRunStore(path.join(repo, 'evals/runs', id), [key]);
  await store.initialize();
  const content =
    '<a href="#schedule">View the wedding schedule</a><section id="schedule">Ceremony at 16:00</section>';
  const now = new Date().toISOString();
  const evidence: TrialEvidence = {
    task,
    variant: 'enabled',
    localUrl: 'http://127.0.0.1:3000',
    artifacts: [
      {
        id: 'a-target',
        path: task.targetFile,
        sha256: hash(content),
        content,
        observedBy: 'evaluator',
      },
    ],
    events: [],
    agent: {
      status: 'completed',
      startedAt: now,
      endedAt: now,
      exitCode: 0,
      signal: null,
      model: null,
      thinkingLevel: null,
      events: [],
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        estimatedCostUsd: 0,
        costSource: 'No Pi call: authored grader smoke case',
      },
    },
  };
  const semantic = await output.during(
    `Checking structured grading with ${profile.grader.model}…`,
    () => new AiSdkRubricGrader(key, profile.grader, rubric).evaluate(evidence, context.signal),
  );
  await store.save('evidence.json', evidence);
  await store.save('semantic.json', semantic);
  await store.save('budget.json', {
    limitUsd: budget.limitUsd,
    reservedEstimateUsd: budget.reservedUsd,
    providerEnforced: false,
  });
  await store.save(
    'report.md',
    renderReport(id, evidence, [semantic.grade], semantic, {
      availableFiles: ['evidence.json', 'semantic.json', 'budget.json'],
    }),
  );
  const report = path.join(store.directory, 'report.md');
  output.result(
    {
      id,
      status: semantic.status,
      grade: semantic.grade,
      usage: semantic.usage,
      report,
      calibration: 'Authored sanity case; pending human calibration review',
    },
    `Grader smoke ${semantic.status}

${gradeLines([semantic.grade])}

API usage: ${formatCost(semantic.usage.estimatedCostUsd)}
No Pi run. This checks connectivity, structure and citations; human calibration remains separate.

Report: ${report}`,
  );
  return semantic.status !== 'completed' || semantic.grade.verdict !== 'pass' ? 2 : 0;
}
