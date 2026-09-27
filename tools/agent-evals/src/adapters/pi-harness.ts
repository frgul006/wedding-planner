import type { AgentRunner, TrialEnvironment } from '../domain/types.ts';
import type { EvaluationProfile, TaskDefinition } from './evaluation-config.ts';

export interface HarnessOptions {
  sourceRepo: string;
  agentSource: string;
  task: TaskDefinition;
  profile: EvaluationProfile;
  signal?: AbortSignal;
}
export interface PreparedHarness {
  agent: AgentRunner;
  environment: TrialEnvironment;
  expectedModel: { provider: string; id: string; thinkingLevel: string };
  inspection: unknown;
  manifest: Record<string, unknown>;
}
export type HarnessFactory = (options: HarnessOptions) => Promise<PreparedHarness>;
import { inspectPi } from './pi-inspection.ts';
import { piModelArguments, selectPiModel } from './pi-model-selection.ts';
import { selectPiEndpoint, checkPiEndpointReadiness } from './pi-endpoint-selection.ts';
import { PiRpcRunner } from './pi-rpc.ts';
import { prepareTrialEnvironment } from './trial-environment.ts';
import { trialInvariants } from './trial-manifest.ts';

/** Native Pi selection and environment wiring are confined to this adapter. */
export const preparePiHarness: HarnessFactory = async (options) => {
  options.signal?.throwIfAborted();
  const pi = await inspectPi({ cwd: options.agentSource });
  const settings = selectPiModel(pi, options.profile.pi);
  const endpointSelection = await selectPiEndpoint({
    agentDir: pi.agentDir,
    provider: settings.provider,
    model: settings.model,
    policy: options.profile.pi.endpoint,
  });
  await checkPiEndpointReadiness(endpointSelection);
  if (
    options.profile.agentBilling === 'subscription' &&
    (settings.provider !== 'openai-codex' || pi.authentication.type !== 'oauth')
  )
    throw new Error(
      'Subscription profile requires verified openai-codex OAuth. Choose an API billing profile for other authentication.',
    );
  const manifest = await trialInvariants(
    options.sourceRepo,
    options.task,
    options.profile,
    pi,
    settings,
    endpointSelection,
  );
  const runner = new PiRpcRunner({
    requiredExtensionCommand: 'eval-sandbox-ready-v1',
    expectedEndpointHash: endpointSelection.effective.sha256,
  });
  return {
    agent: {
      run: (request) =>
        runner.run({
          ...request,
          executable: pi.executable,
          args: [
            ...(request.args ?? []),
            ...(options.profile.pi.model ? piModelArguments(settings) : []),
          ],
        }),
    },
    environment: {
      prepare: (task, id) =>
        prepareTrialEnvironment({
          sourceRepo: options.sourceRepo,
          task,
          id,
          signal: options.signal,
          pi: { ...pi, defaults: settings, endpointSelection },
          runtimeMs: options.profile.runtimeMs,
        }),
    },
    expectedModel: {
      provider: settings.provider,
      id: settings.model,
      thinkingLevel: settings.thinkingLevel,
    },
    inspection: { ...pi, evaluationModel: settings, endpointSelection },
    manifest,
  };
};
