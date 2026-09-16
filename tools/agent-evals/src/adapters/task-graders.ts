import type { Grade, Grader, Task, TrialEvidence } from '../domain/types.ts';
import { gradeAcceptance, gradeDiffScope } from '../domain/acceptance-graders.ts';
import {
  DETERMINISTIC_GRADER_VERSION,
  gradeBrowserBehavior,
  gradeBrowserCompliance,
  gradeOutcome,
} from '../domain/deterministic-graders.ts';
import { AiSdkRubricGrader, type RubricConfig } from './ai-sdk-grader.ts';

export interface GraderContext {
  task: Task;
  semantic?: { key: string; config: RubricConfig; rubric: string };
}
export interface GraderFactory {
  /** Every model grader reserves one call under the shared profile's bounds. */
  metering: 'none' | 'semantic-api';
  create(context: GraderContext): Grader;
}
export type GraderRegistry = Readonly<Record<string, GraderFactory>>;

function mechanical(
  id: string,
  version: string,
  judge: (evidence: TrialEvidence) => Grade,
): GraderFactory {
  return {
    metering: 'none',
    create: () => ({
      id,
      version,
      async grade(evidence) {
        return { grader: id, version, status: 'completed', grades: [judge(evidence)] };
      },
    }),
  };
}

/** Add a factory here; live execution, regrading and admission use the same registry. */
export const graderRegistry: GraderRegistry = {
  'target-outcome': mechanical('target-outcome', DETERMINISTIC_GRADER_VERSION, gradeOutcome),
  'browser-compliance': mechanical(
    'browser-compliance',
    DETERMINISTIC_GRADER_VERSION,
    gradeBrowserCompliance,
  ),
  'browser-behavior': mechanical(
    'browser-behavior',
    DETERMINISTIC_GRADER_VERSION,
    gradeBrowserBehavior,
  ),
  'acceptance-checks': mechanical('acceptance-checks', '1', gradeAcceptance),
  'diff-scope': mechanical('diff-scope', '1', gradeDiffScope),
  'semantic-task-clarity': {
    metering: 'semantic-api',
    create({ semantic }) {
      if (!semantic) throw new Error('Model grader requires admitted semantic configuration');
      return new AiSdkRubricGrader(semantic.key, semantic.config, semantic.rubric);
    },
  },
};
const defaults = [
  'target-outcome',
  'browser-compliance',
  'browser-behavior',
  'semantic-task-clarity',
];

export function selectedGraderIds(task: Task, registry: GraderRegistry = graderRegistry): string[] {
  const ids = task.graders ?? defaults;
  for (const id of ids)
    if (!Object.hasOwn(registry, id)) throw new Error(`Unknown task grader: ${id}`);
  if (new Set(ids).size !== ids.length) throw new Error('Task grader IDs must be unique');
  return [...ids];
}

export function selectedModelGraderCount(
  task: Task,
  registry: GraderRegistry = graderRegistry,
): number {
  return selectedGraderIds(task, registry).filter((id) => registry[id]!.metering === 'semantic-api')
    .length;
}

/** One selection path for live trials and saved-evidence regrading. */
export function createTaskGraders(
  task: Task,
  options: Omit<GraderContext, 'task'> & { registry?: GraderRegistry } = {},
): Grader[] {
  const registry = options.registry ?? graderRegistry;
  return selectedGraderIds(task, registry).flatMap((id) => {
    const factory = registry[id]!;
    if (factory.metering === 'semantic-api' && !options.semantic) return [];
    const grader = factory.create({ task, semantic: options.semantic });
    if (grader.id !== id) throw new Error(`Grader factory ${id} returned ${grader.id}`);
    return [
      {
        id: grader.id,
        version: grader.version,
        metering: factory.metering,
        criteria: grader.criteria,
        grade: (evidence, signal) => grader.grade(evidence, signal),
      },
    ];
  });
}
