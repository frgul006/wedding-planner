import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { AiSdkRubricGrader, checkGraderModel } from '../../adapters/ai-sdk-grader.ts';
import { loadProfile, treeHash } from '../../adapters/evaluation-config.ts';
import { FileRunStore } from '../../adapters/file-run-store.ts';
import {
  listRuns,
  readSavedRun,
  resolveRun,
  sealRegrade,
  selectGrading,
  type GradingRevision,
  type SavedRun,
} from '../../adapters/saved-runs.ts';
import { defaultEnvFile, loadGraderKey } from '../../adapters/secrets.ts';
import { EstimatedBudget } from '../../domain/budget.ts';
import { compareTrials } from '../../domain/comparison.ts';
import { gradeEvidence, flattenGrades } from '../../application/grade-evidence.ts';
import {
  createTaskGraders,
  selectedGraderIds,
  selectedModelGraderCount,
} from '../../adapters/task-graders.ts';
import { semanticView } from '../grading-view.ts';
import { renderComparisonReport, renderReport } from '../../domain/report.ts';
import { timestampId, type CommandContext } from '../context.ts';
import { gradeLines, table } from '../output.ts';
import { savedRunView } from '../presenters/saved-run.ts';

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function gradingCriteria(run: SavedRun, revision: GradingRevision) {
  if (revision.gradingResults)
    return {
      harnessHash: revision.harnessHash ?? object(run.manifest.invariants).harnessHash,
      graders: revision.gradingResults
        .map(({ grader, version, criteria }) => ({ id: grader, version, criteria }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    };
  const semantic = object(revision.semantic);
  const hasSemantic = revision.grades.some((grade) => grade.grader === 'semantic-task-clarity');
  return {
    graders: revision.grades
      .map((grade) => ({ id: grade.grader, version: grade.version }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    harnessHash: revision.harnessHash ?? object(run.manifest.invariants).harnessHash,
    semantic: hasSemantic
      ? {
          model: semantic.model,
          rubricHash: semantic.rubricHash ?? object(run.manifest.rubric).sha256,
          configuration:
            object(revision.criteria).semanticConfiguration ?? object(run.manifest.profile).grader,
        }
      : null,
  };
}

export async function savedCommand(context: CommandContext): Promise<number> {
  const { repo, callerCwd, request, output } = context;
  if (request.command === 'runs') {
    const all = await listRuns(repo);
    const runs = all.slice(0, Number(request.values.limit ?? 10));
    output.result(
      { runs, total: all.length },
      runs.length
        ? `Recent trials

${table(
  ['ID', 'TASK', 'INSTRUCTION', 'STATUS'],
  runs.map((run) => [run.id, run.task, run.variant, run.status]),
)}

Next: pnpm evals show latest`
        : 'No saved trials yet.\n\nTry: pnpm evals run ui-copy --dry-run',
    );
    return 0;
  }
  if (request.command === 'compare') return compareCommand(context);
  const directory = await resolveRun(repo, request.args[0] ?? 'latest', callerCwd);
  const run = await readSavedRun(directory);
  if (request.command === 'regrade') return regradeCommand(context, run);
  const selected = selectGrading(run, request.values.grades);
  const view = savedRunView(run, selected);
  output.result(view.data, view.human);
  return 0;
}

async function regradeCommand(context: CommandContext, run: SavedRun): Promise<number> {
  const { repo, request, callerCwd, output } = context;
  // Override only factory selection. Graders still receive the original sealed evidence.
  const gradingTask =
    request.values.graders === undefined
      ? run.evidence.task
      : {
          ...run.evidence.task,
          graders: request.values.graders.split(',').map((id) => id.trim()),
        };
  const selectedGraders = selectedGraderIds(gradingTask);
  const modelGraderCount = selectedModelGraderCount(gradingTask);
  if (request.values.graders !== undefined && modelGraderCount && !request.values.semantic)
    throw new Error('Explicit API grader selection requires --semantic.');
  let semanticOptions: Parameters<typeof createTaskGraders>[1] = {};
  let key = '';
  let budget: unknown = {
    appliesTo: 'none; offline deterministic regrade',
    reservedEstimateUsd: 0,
  };
  let semanticConfiguration: unknown;
  if (request.values.semantic) {
    if (!modelGraderCount)
      throw new Error(
        'No API grader is selected. Use --graders to select a registered API grader with --semantic.',
      );
    const profile = await loadProfile(repo, request.values.profile, {
      budgetUsd: request.values['budget-usd'],
      graderModel: request.values['grader-model'],
      graderInputPrice: request.values['grader-input-price'],
      graderOutputPrice: request.values['grader-output-price'],
    });
    const rubricName = object(run.evidence.task).rubric ?? 'task-clarity';
    if (typeof rubricName !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(rubricName))
      throw new Error('Saved task has an invalid rubric name.');
    const rubric = await readFile(path.join(repo, 'evals/rubrics', `${rubricName}.md`), 'utf8');
    // Admission precedes credentials and all external work, including availability checks.
    const reservation =
      modelGraderCount * new AiSdkRubricGrader('', profile.grader, rubric).reservationUsd();
    const allowance = new EstimatedBudget(profile.estimatedApiBudgetUsd);
    allowance.reserve(reservation);
    budget = {
      appliesTo: 'grader API call only; saved Pi trial is not rerun',
      limitUsd: allowance.limitUsd,
      reservedEstimateUsd: allowance.reservedUsd,
      providerEnforced: false,
    };
    const envFile = request.values['grader-env-file']
      ? path.resolve(callerCwd, request.values['grader-env-file'])
      : defaultEnvFile(repo);
    key = await loadGraderKey(envFile);
    await checkGraderModel(key, profile.grader.model, context.signal);
    semanticConfiguration = profile.grader;
    semanticOptions = { semantic: { key, config: profile.grader, rubric } };
  }
  const gradingResults = await output.during('Grading saved evidence…', () =>
    gradeEvidence(run.evidence, createTaskGraders(gradingTask, semanticOptions), context.signal),
  );
  const grades = flattenGrades(gradingResults);
  const semantic = semanticView(gradingResults);
  const name = `regrade-${timestampId()}`;
  const harnessHash = await treeHash(path.join(repo, 'tools/agent-evals/src'));
  const regradedAt = new Date().toISOString();
  const store = new FileRunStore(run.directory, [key]);
  await store.save(`${name}.json`, {
    grades,
    gradingResults,
    semantic,
    budget,
    regradedAt,
    harnessHash,
    criteria: { selectedGraders, semanticConfiguration },
    sourceIntegrityHash: run.integrityHash,
  });
  await store.save(
    `${name}.md`,
    renderReport(name, run.evidence, grades, semantic, {
      gradingResults,
      trialId: run.id,
      regrade: { id: name, regradedAt, harnessHash, sourceIntegrityHash: run.integrityHash },
      availableFiles: [
        ...(await readdir(run.directory)).filter((file) =>
          [
            'manifest.json',
            'evidence.json',
            'transcript.jsonl',
            'environment.json',
            'skills.json',
          ].includes(file),
        ),
        `${name}.json`,
      ],
    }),
  );
  await sealRegrade(store, name);
  const report = path.join(run.directory, `${name}.md`);
  output.result(
    {
      trialId: run.id,
      revision: name,
      grades,
      gradingResults,
      selectedGraders,
      semantic: semantic ?? null,
      budget,
      report,
    },
    `Regraded ${run.id}

${gradeLines(grades)}

${gradingResults.some((result) => result.metering === 'semantic-api' || result.usage) ? 'API grading attempted; see recorded status and usage. Pi was not rerun.' : 'Offline · no new model calls or API cost.'}
Original evidence and grades retained.

Report: ${report}
Next: pnpm evals show ${run.id}`,
  );
  return semantic?.status === 'grader_error' ||
    grades.some((grade) => ['fail', 'unknown'].includes(grade.verdict))
    ? 2
    : 0;
}

async function compareCommand(context: CommandContext): Promise<number> {
  const { repo, callerCwd, request, output } = context;
  const runs = await Promise.all(
    request.args.map(async (reference) =>
      readSavedRun(await resolveRun(repo, reference, callerCwd)),
    ),
  );
  const revisions = runs.map((run) => selectGrading(run, request.values.grades));
  const pair = runs.map((run, index) => ({
    variant: run.evidence.variant,
    invariants: run.manifest.invariants,
    comparisonEligible: run.manifest.comparisonEligible === true,
    grading: gradingCriteria(run, revisions[index]),
  }));
  const factor = (request.values.factor ?? 'instruction') as
    'instruction' | 'model' | 'agent-configuration';
  const result = compareTrials(pair[0], pair[1], { factor });
  const observations = runs.map((run, index) => ({
    id: run.id,
    variant: run.evidence.variant,
    status: run.evidence.agent.status,
    reportPath: revisions[index].reportPath,
    grades: revisions[index].grades,
    grading: {
      label: revisions[index].label,
      harnessHash: revisions[index].harnessHash,
      gradedAt: revisions[index].gradedAt,
    },
  }));
  const id = `comparison-${timestampId()}`;
  const store = new FileRunStore(path.join(repo, 'evals/runs', id));
  await store.initialize();
  await store.save('comparison.json', {
    ...result,
    factor,
    observations,
    selectedGrades: request.values.grades ?? 'latest',
  });
  await store.save('report.md', renderComparisonReport(id, result, observations));
  const report = path.join(store.directory, 'report.md');
  output.result(
    { ...result, observations, report },
    `Comparison ${result.eligible ? 'eligible' : 'ineligible'}

${result.reason}

${table(
  ['INSTRUCTION', 'TRIAL STATUS', 'GRADING'],
  observations.map((item) => [item.variant, item.status, item.grading.label]),
)}

Report: ${report}
${result.eligible ? 'Repeat matched trials before estimating instruction usefulness.' : 'Match the listed conditions before comparing behavior.'}`,
  );
  return result.eligible ? 0 : 2;
}
