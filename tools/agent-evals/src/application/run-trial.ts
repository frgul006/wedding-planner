import type {
  AgentResult,
  AgentRunner,
  EvidenceEvent,
  FinalObservation,
  PreparedEnvironment,
  RunStore,
  Task,
  TrialEnvironment,
  TrialEvidence,
} from '../domain/types.ts';
import { availableSkills, discoveredSkills, type InventorySkill } from './skill-inventory.ts';
import { resolveTrialLimits } from '../domain/trial-limits.ts';

export interface RunTrialOptions {
  signal?: AbortSignal;
  id: string;
  task: Task;
  runtimeMs: number;
  maxTokens: number;
  maxTurns?: number;
  maxEstimatedCostUsd: number | null;
  expectedModel: { provider: string; id: string; thinkingLevel: string };
  executable?: string;
  manifest: Record<string, unknown>;
}
export async function runTrial(
  options: RunTrialOptions,
  ports: { environment: TrialEnvironment; agent: AgentRunner; store: RunStore },
) {
  const limits = resolveTrialLimits(options.task.limits, {
    runtimeMs: options.runtimeMs,
    maxTokens: options.maxTokens,
    maxTurns: options.maxTurns,
  });
  const startedAt = new Date().toISOString();
  const events: EvidenceEvent[] = [];
  const agentEvents: EvidenceEvent[] = [];
  const recordedAgentEventIds = new Set<string>();
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
  let before = '';
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
    events: [],
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
  let manifestMetadata = options.manifest;
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
    const priorInvariants = options.manifest.invariants;
    if (priorInvariants && typeof priorInvariants === 'object' && !Array.isArray(priorInvariants)) {
      manifestMetadata = {
        ...options.manifest,
        invariants: {
          ...priorInvariants,
          runtime: environment.provenance.comparableRuntime ?? environment.provenance.runtime,
          skillTreeFingerprint: environment.provenance.skillTreeFingerprint,
        },
      };
    }
    await ports.store.save('environment.json', environment.provenance);
    lifecycle('environment', {
      type: 'environment_prepared',
      workspace: environment.workspace,
      url: environment.url,
    });
    preparedSkills = availableSkills(environment.provenance);
    if (preparedSkills.length)
      lifecycle('environment', {
        type: 'skill_inventory',
        source: 'prepared-resource-files',
        skills: preparedSkills,
        note: 'Files copied by environment setup; native discovery and content loading are not yet observed.',
      });
    options.signal?.throwIfAborted();
    beforeArtifacts = (await environment.collectArtifacts()).map((artifact) => ({
      ...artifact,
      id: `before-${artifact.id}`,
    }));
    before = beforeArtifacts.find((a) => a.path === options.task.targetFile)?.content ?? '';
    options.signal?.throwIfAborted();
    agent = await ports.agent.run({
      signal: options.signal,
      cwd: environment.workspace,
      env: environment.env,
      args: environment.agentArgs,
      executable: options.executable,
      prompt: [options.task.prompt, environment.agentContext].filter(Boolean).join('\n\n'),
      expectedModel: options.expectedModel,
      ...limits,
      maxEstimatedCostUsd: options.maxEstimatedCostUsd,
      onEvent: (event) => {
        if (recordedAgentEventIds.has(event.id)) return;
        recordedAgentEventIds.add(event.id);
        agentEvents.push(record(event));
      },
    });
    // Runners may return a complete recording without streaming. Preserve both
    // delivery modes while avoiding duplicated events from streaming runners.
    for (const event of agent.events) {
      if (recordedAgentEventIds.has(event.id)) continue;
      recordedAgentEventIds.add(event.id);
      agentEvents.push(record(event));
    }
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
          if (finalObservation.beforeArtifacts)
            beforeArtifacts = finalObservation.beforeArtifacts.map((artifact) => ({
              ...artifact,
              id: artifact.id.startsWith('before-') ? artifact.id : `before-${artifact.id}`,
            }));
        } catch (error) {
          agent = { ...agent, status: 'infrastructure_error', error: 'Final observation failed' };
          lifecycle('evaluator', {
            type: 'artifact_collection_error',
            message: error instanceof Error ? error.message : 'Unknown final observation error',
          });
        }
      }
      // Stop tool descendants before observing final files; background commands
      // must not be able to mutate an artifact while the evaluator collects it.
      try {
        await environment.cleanup();
      } catch (error) {
        cleanupError = error instanceof Error ? error.message : 'Unknown cleanup error';
        statusBeforeCleanupFailure = agent.status;
        agent = { ...agent, status: 'infrastructure_error' };
      }
      try {
        if (!finalObservation) artifacts = await environment.collectArtifacts();
      } catch (error) {
        agent = { ...agent, status: 'infrastructure_error', error: 'Artifact collection failed' };
        lifecycle('evaluator', {
          type: 'artifact_collection_error',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }
  lifecycle('evaluator', {
    type: 'trial_observation',
    targetFile: options.task.targetFile,
    targetBeforeContent: before,
    targetAfterContent: artifacts.find((a) => a.path === options.task.targetFile)?.content,
  });
  if (cleanupError)
    lifecycle('evaluator', {
      type: 'cleanup_error',
      message: cleanupError,
      statusBeforeCleanupFailure,
    });
  agent.events = agentEvents;
  agent = { ...agent, limits: agent.limits ?? limits };
  const evidence: TrialEvidence = {
    task: options.task,
    localUrl: environment?.url ?? 'http://127.0.0.1:0',
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
    ...manifestMetadata,
    id: options.id,
    startedAt,
    endedAt: new Date().toISOString(),
    status: agent.status,
    workspace: environment?.workspace,
    cleanupError,
    statusBeforeCleanupFailure,
    attempts: [{ attempt: 1, status: agent.status, error: agent.error, retries: 0 }],
    agentUsage: agent.usage,
    limits: agent.limits,
    limitUsage: agent.limitUsage,
    limitHit: agent.limitHit,
  };
  await ports.store.save('manifest.json', manifest);
  return { evidence, manifest };
}
