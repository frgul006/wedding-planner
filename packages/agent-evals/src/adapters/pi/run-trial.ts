import type {
  AgentResult,
  AgentRunner,
  EvidenceEvent,
  FinalObservation,
  PreparedEnvironment,
  RunStore,
  TrialEnvironment,
  TrialEvidence,
} from './types.ts';
import { availableSkills, discoveredSkills, type InventorySkill } from './skill-inventory.ts';
import type { TrialLimits } from '../../core/trial-limits.ts';
import type { EvaluationTask } from '../../core/types.ts';

export interface RunTrialOptions {
  signal?: AbortSignal;
  id: string;
  task: EvaluationTask;
  limits: TrialLimits;
  maxEstimatedCostUsd: number | null;
  expectedModel: { provider: string; id: string; thinkingLevel: string };
  manifest: Record<string, unknown>;
}

export async function runTrial(
  options: RunTrialOptions,
  ports: { environment: TrialEnvironment; agent: AgentRunner; store: RunStore },
) {
  const { limits } = options;
  const startedAt = new Date().toISOString();
  const events: EvidenceEvent[] = [];
  let preparedSkills: InventorySkill[] = [];
  let recordedDiscovery = false;
  const record = (event: Omit<EvidenceEvent, 'id' | 'sequence'>): EvidenceEvent => {
    const normalized = {
      ...event,
      id: `e${String(events.length + 1).padStart(5, '0')}`,
      sequence: events.length + 1,
    };
    events.push(normalized);
    ports.store.append(normalized);
    if (
      !recordedDiscovery &&
      event.actor === 'evaluator' &&
      event.observation?.type === 'skills_discovered'
    ) {
      recordedDiscovery = true;
      record({
        actor: 'evaluator',
        kind: 'lifecycle',
        timestamp: event.timestamp,
        data: {
          type: 'skill_inventory',
          source: 'agent-resource-discovery',
          derivedFrom: [normalized.id],
          skills: discoveredSkills(preparedSkills, event.observation.skills),
          note: 'Discovery does not prove full skill content was loaded, nor that its description is visible to the model.',
        },
      });
    }
    return normalized;
  };
  const lifecycle = (actor: 'environment' | 'evaluator', data: Record<string, unknown>) =>
    record({ timestamp: new Date().toISOString(), actor, kind: 'lifecycle', data });
  let environment: PreparedEnvironment | undefined;
  let beforeArtifacts: TrialEvidence['artifacts'] = [];
  let finalObservation: FinalObservation | undefined;
  let cleanupError: string | undefined;
  let statusBeforeCleanupFailure: AgentResult['status'] | undefined;
  let agent: AgentResult = {
    status: 'infrastructure_error',
    startedAt,
    endedAt: startedAt,
    exitCode: null,
    signal: null,
    model: null,
    thinkingLevel: null,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      estimatedCostUsd: null,
      costSource: 'Unknown: agent did not return usage',
    },
    limits,
  };
  let artifacts: TrialEvidence['artifacts'] = [];
  await ports.store.save('manifest.json', {
    ...options.manifest,
    id: options.id,
    startedAt,
    status: 'preparing',
    limits,
  });
  try {
    options.signal?.throwIfAborted();
    environment = await ports.environment.prepare(options.task, options.id);
    await ports.store.save('environment.json', environment.provenance);
    lifecycle('environment', {
      type: 'environment_prepared',
      workspace: environment.workspace,
      url: environment.url,
    });
    preparedSkills = availableSkills(environment.provenance);
    if (preparedSkills.length) {
      lifecycle('environment', {
        type: 'skill_inventory',
        source: 'prepared-resource-files',
        skills: preparedSkills,
        note: 'Files copied by environment setup; native discovery and content loading are not yet observed.',
      });
    }
    options.signal?.throwIfAborted();
    beforeArtifacts = (await environment.collectArtifacts()).map((artifact) => ({
      ...artifact,
      id: `before-${artifact.id}`,
    }));
    options.signal?.throwIfAborted();
    agent = await ports.agent.run({
      signal: options.signal,
      cwd: environment.workspace,
      env: environment.env,
      args: environment.agentArgs,
      prompt: [options.task.prompt, environment.agentContext].filter(Boolean).join('\n\n'),
      expectedModel: options.expectedModel,
      limits,
      maxEstimatedCostUsd: options.maxEstimatedCostUsd,
      onEvent: record,
    });
  } catch (error) {
    // Never persist adapter error objects or cause chains (may contain credentials).
    const cancelled =
      options.signal?.aborted &&
      (error === options.signal.reason || (error instanceof Error && error.name === 'AbortError'));
    const message = cancelled
      ? 'Evaluation cancelled by user.'
      : error instanceof Error
        ? error.message
        : 'Unknown infrastructure error';
    agent = {
      ...agent,
      status: cancelled ? 'cancelled' : 'infrastructure_error',
      error: message,
      endedAt: new Date().toISOString(),
    };
    lifecycle('evaluator', {
      type: cancelled ? 'cancellation_requested' : 'infrastructure_error',
      message,
    });
  } finally {
    if (environment) {
      if (environment.finalize) {
        try {
          finalObservation = await environment.finalize();
          artifacts = finalObservation.artifacts;
          if (finalObservation.beforeArtifacts) {
            beforeArtifacts = finalObservation.beforeArtifacts.map((artifact) => ({
              ...artifact,
              id: artifact.id.startsWith('before-') ? artifact.id : `before-${artifact.id}`,
            }));
          }
        } catch (error) {
          agent = { ...agent, status: 'infrastructure_error', error: 'Final observation failed' };
          lifecycle('evaluator', {
            type: 'artifact_collection_error',
            message: error instanceof Error ? error.message : 'Unknown final observation error',
          });
        }
      }
      // Stop registered tool groups before fallback artifact capture.
      try {
        await environment.cleanup();
      } catch (error) {
        cleanupError = error instanceof Error ? error.message : 'Unknown cleanup error';
        statusBeforeCleanupFailure = agent.status;
        agent = { ...agent, status: 'infrastructure_error' };
      }
      try {
        if (!finalObservation) {
          artifacts = await environment.collectArtifacts();
        }
      } catch (error) {
        agent = { ...agent, status: 'infrastructure_error', error: 'Artifact collection failed' };
        lifecycle('evaluator', {
          type: 'artifact_collection_error',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }
  if (cleanupError) {
    lifecycle('evaluator', {
      type: 'cleanup_error',
      message: cleanupError,
      statusBeforeCleanupFailure,
    });
  }
  agent = { ...agent, limits: agent.limits ?? limits };
  const evidence: TrialEvidence = {
    task: { ...options.task },
    ...(environment?.url ? { localUrl: environment.url } : {}),
    agent,
    artifacts,
    beforeArtifacts,
    ...(finalObservation?.patch ? { patch: finalObservation.patch } : {}),
    ...(finalObservation?.changedFiles ? { changedFiles: finalObservation.changedFiles } : {}),
    ...(finalObservation?.checks ? { checks: finalObservation.checks } : {}),
    events,
  };
  // Persist the observed attempt; the portable evaluator owns separate grading records.
  await ports.store.save('evidence.json', evidence);
  const manifest = {
    ...options.manifest,
    id: options.id,
    startedAt,
    endedAt: new Date().toISOString(),
    status: agent.status,
    workspace: environment?.workspace,
    cleanupError,
    statusBeforeCleanupFailure,
    error: agent.error,
    agentUsage: agent.usage,
    limits: agent.limits,
    limitUsage: agent.limitUsage,
    limitHit: agent.limitHit,
  };
  await ports.store.save('manifest.json', manifest);
  return { evidence, manifest };
}
