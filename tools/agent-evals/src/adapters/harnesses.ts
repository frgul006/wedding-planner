import type { AgentRunner, TrialEnvironment } from '../domain/types.ts';
import type { EvaluationProfile, TaskDefinition } from './evaluation-config.ts';
import { preparePiHarness } from './pi-harness.ts';

export interface HarnessOptions {
  sourceRepo: string;
  agentSource: string;
  task: TaskDefinition;
  profile: EvaluationProfile;
  rubric: string;
  signal?: AbortSignal;
}
export interface PreparedHarness {
  agent: AgentRunner;
  environment: TrialEnvironment;
  expectedModel: { provider: string; id: string; thinkingLevel: string };
  inspection: unknown;
  manifest: Record<string, unknown>;
  description: string;
}
export type HarnessFactory = (options: HarnessOptions) => Promise<PreparedHarness>;
export const harnesses: Readonly<Record<string, HarnessFactory>> = { pi: preparePiHarness };

/** Register another adapter here; trial orchestration and CLI commands stay unchanged. */
export function createHarness(
  name: string,
  options: HarnessOptions,
  registry = harnesses,
): Promise<PreparedHarness> {
  const factory = Object.hasOwn(registry, name) ? registry[name] : undefined;
  if (!factory)
    throw new Error(`Unknown harness "${name}". Registered: ${Object.keys(registry).join(', ')}`);
  return factory(options);
}
