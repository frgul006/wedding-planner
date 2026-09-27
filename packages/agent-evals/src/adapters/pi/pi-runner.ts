import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { EvaluationTask, Runner } from '../../core/types.ts';
import type { AgentResult, AgentRunRequest, PreparedEnvironment, TrialEvidence } from './types.ts';
import {
  CACHED_TOKEN_WEIGHT,
  resolveTrialLimits,
  type TrialLimits,
} from '../../core/trial-limits.ts';
import { runTrial } from './run-trial.ts';
import { FileRunStore } from './file-run-store.ts';
import { recordedTrialFromEvidence } from './recorded-trial.ts';
import { immutableCopy } from '../../core/serialization.ts';
import { inspectPi } from './pi-inspection.ts';
import { piModelArguments, selectPiModel, type PiModelSelection } from './pi-model-selection.ts';
import {
  selectPiEndpoint,
  type PiEndpointPolicy,
  type PiEndpointSelection,
} from './pi-endpoint-selection.ts';
import { PiRpcRunner } from './pi-rpc.ts';

export type PiBilling =
  | { type: 'subscription'; maxEstimatedCostUsd: null }
  | { type: 'api'; maxEstimatedCostUsd: number };

export interface PiEnvironmentContext {
  task: EvaluationTask;
  trialId: string;
  signal?: AbortSignal;
  limits: TrialLimits;
  pi: Awaited<ReturnType<typeof inspectPi>> & {
    defaults: PiModelSelection;
    endpointSelection: PiEndpointSelection;
  };
}

export interface PiRunnerOptions {
  agentSource: string;
  recordingsDirectory: string;
  model?: string;
  endpoint?: PiEndpointPolicy;
  limits?: Partial<TrialLimits>;
  billing: PiBilling;
  requiredExtensionCommand?: string;
  /** The consumer owns task setup, isolation, acceptance checks and cleanup. */
  prepareEnvironment(context: PiEnvironmentContext): Promise<PreparedEnvironment>;
}

interface ExecutionSafeguards {
  requiredExtensionCommand?: string;
  expectedEndpointHash: string;
}

/** Native execution and recording; each consumer supplies its own task environment. */
export function piRunner(
  options: PiRunnerOptions,
  dependencies: {
    inspect?: typeof inspectPi;
    execute?: (request: AgentRunRequest, safeguards: ExecutionSafeguards) => Promise<AgentResult>;
  } = {},
): Runner {
  const { prepareEnvironment, ...configuration } = options;
  if (typeof prepareEnvironment !== 'function')
    throw new Error('A Pi runner requires a prepareEnvironment callback.');
  const config = immutableCopy(configuration);
  if (
    config.billing.type === 'subscription'
      ? config.billing.maxEstimatedCostUsd !== null
      : config.billing.type !== 'api' ||
        !Number.isFinite(config.billing.maxEstimatedCostUsd) ||
        config.billing.maxEstimatedCostUsd <= 0
  )
    throw new Error(
      'Subscription billing requires a null cost limit; API billing requires a positive finite dollar limit.',
    );
  const agentSource = resolve(config.agentSource);
  const recordingsDirectory = resolve(config.recordingsDirectory);
  const inspect = dependencies.inspect ?? inspectPi;
  const execute =
    dependencies.execute ?? ((request, safeguards) => new PiRpcRunner(safeguards).run(request));
  return {
    async run(task, request) {
      task = immutableCopy(task);
      request = {
        ...request,
        ...(request.limits === undefined ? {} : { limits: immutableCopy(request.limits) }),
      };
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,179}$/.test(request.trialId))
        throw new Error('Use a filesystem-safe trial ID.');
      const limits = immutableCopy(resolveTrialLimits(config.limits, task.limits, request.limits));
      request.signal?.throwIfAborted();
      const directory = join(recordingsDirectory, request.trialId);
      await mkdir(recordingsDirectory, { recursive: true, mode: 0o700 });
      // An explicit ID must never replace an earlier attempt.
      await mkdir(directory, { mode: 0o700 });
      const store = new FileRunStore(directory);
      const inspection = await inspect({ cwd: agentSource });
      const settings = selectPiModel(inspection, config);
      const endpointSelection = await selectPiEndpoint({
        agentDir: inspection.agentDir,
        provider: settings.provider,
        model: settings.model,
        policy: config.endpoint,
      });
      if (
        config.billing.type === 'subscription' &&
        (settings.provider !== 'openai-codex' || inspection.authentication.type !== 'oauth')
      )
        throw new Error(
          'Subscription billing requires verified openai-codex OAuth. Choose API billing for other authentication.',
        );
      const pi = immutableCopy({ ...inspection, defaults: settings, endpointSelection });
      await store.save('inspection.json', {
        ...inspection,
        evaluationModel: settings,
        endpointSelection,
      });
      await runTrial(
        {
          id: request.trialId,
          signal: request.signal,
          task,
          limits,
          maxEstimatedCostUsd: config.billing.maxEstimatedCostUsd,
          expectedModel: {
            provider: settings.provider,
            id: settings.model,
            thinkingLevel: settings.thinkingLevel,
          },
          manifest: {
            runner: 'pi-library-v2',
            agentSource,
            billing: config.billing,
            model: settings,
            endpointSelection,
          },
        },
        {
          agent: {
            run: (agentRequest) =>
              execute(
                {
                  ...agentRequest,
                  executable: pi.executable,
                  args: [
                    ...(agentRequest.args ?? []),
                    ...(config.model ? piModelArguments(settings) : []),
                  ],
                },
                {
                  requiredExtensionCommand: config.requiredExtensionCommand,
                  expectedEndpointHash: endpointSelection.effective.sha256,
                },
              ),
          },
          environment: {
            prepare: () =>
              prepareEnvironment({
                task,
                trialId: request.trialId,
                signal: request.signal,
                limits,
                pi,
              }),
          },
          store,
        },
      );
      const files = await readdir(directory);
      await store.seal(files.filter((file) => file.endsWith('.json') || file.endsWith('.jsonl')));
      // Saved bytes already passed capture redaction. Never grade unredacted
      // memory or recover historical context from today's resources.
      const evidence = JSON.parse(
        await readFile(join(directory, 'evidence.json'), 'utf8'),
      ) as TrialEvidence;
      const environment = files.includes('environment.json')
        ? (JSON.parse(await readFile(join(directory, 'environment.json'), 'utf8')) as Record<
            string,
            unknown
          >)
        : {};
      const trial = recordedTrialFromEvidence(request.trialId, evidence, environment);
      trial.metadata = {
        ...trial.metadata,
        recordingDirectory: directory,
        recordingIntegrity: join(directory, 'integrity.json'),
        limits,
        cachedTokenWeight: CACHED_TOKEN_WEIGHT,
      };
      return trial;
    },
  };
}
