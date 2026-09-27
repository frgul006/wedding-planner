import type { HarnessFactory } from './harnesses.ts';
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
    options.rubric,
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
      prepare: (task, variant, id) =>
        prepareTrialEnvironment({
          sourceRepo: options.sourceRepo,
          task,
          variant,
          id,
          signal: options.signal,
          pi: { ...pi, defaults: settings, endpointSelection },
          runtimeMs: options.profile.runtimeMs,
          piRuntime: options.profile.pi.runtime,
        }),
    },
    expectedModel: {
      provider: settings.provider,
      id: settings.model,
      thinkingLevel: settings.thinkingLevel,
    },
    inspection: { ...pi, evaluationModel: settings, endpointSelection },
    manifest,
    description: `Pi profile: ${options.agentSource} · project ${pi.resources.projectTrusted ? 'trusted' : 'untrusted'} · ${pi.resources.skills.length} skills\nModel: ${settings.provider}/${settings.model} · ${settings.thinkingLevel} · runtime ${options.profile.pi.runtime} · endpoint ${endpointSelection.policy} (${endpointSelection.effective.origin})`,
  };
};
