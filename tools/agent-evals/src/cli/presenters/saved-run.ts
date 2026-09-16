import path from 'node:path';
import type { GradingRevision, SavedRun } from '../../adapters/saved-runs.ts';
import { formatCost, formatDuration, formatObservedTokens, gradeLines, table } from '../output.ts';

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Build both CLI views from one selected revision; never merge grading histories. */
export function savedRunView(run: SavedRun, selected: GradingRevision) {
  const { agent, task, variant } = run.evidence;
  const model = object(agent.model);
  const provider = typeof model.provider === 'string' ? model.provider : 'unknown';
  const modelId = typeof model.id === 'string' ? model.id : 'unknown';
  const duration = formatDuration(Date.parse(agent.endedAt) - Date.parse(agent.startedAt));
  const selectedApiCost = object(object(selected.semantic).usage).estimatedCostUsd;
  const originalApiCost = object(object(run.original.semantic).usage).estimatedCostUsd;
  const revisions = [run.original, ...run.regrades].map((revision) => ({
    id: revision.id,
    grades: revision.grades,
    report: revision.reportPath,
  }));

  const sections = [
    `Trial ${run.id}\nStatus: ${agent.status} · ${task.id} · instruction ${variant}`,
    `Pi: ${provider}/${modelId} · ${agent.thinkingLevel ?? 'unknown'} · ${formatObservedTokens(agent.usage)} · ${duration}\nOriginal API grader: ${run.original.semantic ? formatCost(originalApiCost) : 'not run · $0'}`,
    `Grading: ${selected.label}\n${gradeLines(selected.grades)}`,
    'Grading history\n' +
      table(
        ['REVISION', 'JUDGMENTS'],
        revisions.map((revision) => [
          revision.id,
          revision.grades.map((grade) => `${grade.grader}: ${grade.verdict}`).join(' · '),
        ]),
      ),
  ];
  if (selected.id !== 'original') {
    sections.push(
      `Selected revision API grader: ${selected.semantic ? formatCost(selectedApiCost) : 'not run · $0'}`,
    );
  }
  if (run.invalidRegrades.length) {
    sections.push(
      'Invalid appended revisions\n' +
        run.invalidRegrades.map((revision) => `${revision.id}: ${revision.reason}`).join('\n') +
        '\nOriginal evidence remains available; run regrade to recover.',
    );
  }
  if (agent.error) sections.push(`Cause: ${agent.error}`);
  if (run.warnings.length) sections.push(run.warnings.join('\n'));
  sections.push(
    `Report: ${selected.reportPath}\nEvidence: ${path.join(run.directory, 'evidence.json')}`,
  );

  return {
    data: {
      id: run.id,
      status: agent.status,
      task: task.id,
      variant,
      selectedGrading: selected.id,
      grades: selected.grades,
      agentUsage: agent.usage,
      originalSemantic: run.original.semantic ?? null,
      selectedSemantic: selected.semantic ?? null,
      revisions,
      invalidRegrades: run.invalidRegrades,
      warnings: run.warnings,
      report: selected.reportPath,
      directory: run.directory,
    },
    human: sections.join('\n\n'),
  };
}
