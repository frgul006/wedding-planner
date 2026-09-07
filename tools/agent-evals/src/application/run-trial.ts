import type {
  AgentResult,
  AgentRunner,
  EvidenceEvent,
  Grade,
  Grader,
  PreparedEnvironment,
  RunStore,
  Task,
  TrialEnvironment,
  TrialEvidence,
} from '../domain/types.ts';
import { availableSkills, discoveredSkills, type InventorySkill } from './skill-inventory.ts';

export interface RunTrialOptions {
  signal?: AbortSignal;
  id: string;
  task: Task;
  variant: 'enabled' | 'disabled';
  runtimeMs: number;
  maxTokens: number;
  maxEstimatedCostUsd: number | null;
  expectedModel: { provider: string; id: string; thinkingLevel: string };
  executable?: string;
  manifest: Record<string, unknown>;
}
export async function runTrial(
  options: RunTrialOptions,
  ports: { environment: TrialEnvironment; agent: AgentRunner; grader: Grader; store: RunStore },
) {
  const startedAt = new Date().toISOString();
  const events: EvidenceEvent[] = [];
  const agentEvents: EvidenceEvent[] = [];
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
  };
  let artifacts: TrialEvidence['artifacts'] = [];
  let manifestMetadata = options.manifest;
  await ports.store.save('manifest.json', {
    ...options.manifest,
    id: options.id,
    startedAt,
    status: 'preparing',
  });
  try {
    options.signal?.throwIfAborted();
    environment = await ports.environment.prepare(options.task, options.variant, options.id);
    const priorInvariants = options.manifest.invariants;
    if (priorInvariants && typeof priorInvariants === 'object' && !Array.isArray(priorInvariants)) {
      manifestMetadata = {
        ...options.manifest,
        invariants: {
          ...priorInvariants,
          runtime: environment.provenance.runtime,
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
    before =
      (await environment.collectArtifacts()).find((a) => a.path === options.task.targetFile)
        ?.content ?? '';
    options.signal?.throwIfAborted();
    agent = await ports.agent.run({
      signal: options.signal,
      cwd: environment.workspace,
      env: environment.env,
      args: environment.agentArgs,
      executable: options.executable,
      prompt: `${options.task.prompt}\n\nThe local development server is already running at ${environment.url}.`,
      expectedModel: options.expectedModel,
      runtimeMs: options.runtimeMs,
      maxTokens: options.maxTokens,
      maxEstimatedCostUsd: options.maxEstimatedCostUsd,
      onEvent: (event) => {
        agentEvents.push(record(event));
      },
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
        artifacts = await environment.collectArtifacts();
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
  const evidence: TrialEvidence = {
    task: options.task,
    variant: options.variant,
    localUrl: environment?.url ?? 'http://127.0.0.1:0',
    agent,
    artifacts,
    events,
  };
  // A later grader failure must not lose a completed, potentially paid trial.
  await ports.store.save('evidence.json', evidence);
  let grades: Grade[];
  try {
    grades = await ports.grader.grade(evidence, options.signal);
  } catch (error) {
    const cancelled =
      options.signal?.aborted &&
      (error === options.signal.reason || (error instanceof Error && error.name === 'AbortError'));
    lifecycle('evaluator', {
      type: cancelled ? 'grader_cancelled' : 'grader_error',
      message: cancelled
        ? 'Grading cancelled by user; saved evidence can be regraded.'
        : 'The grading adapter failed; saved evidence can be regraded.',
    });
    grades = [
      {
        grader: 'deterministic',
        version: '1',
        verdict: 'unknown',
        reason: cancelled ? 'Grading cancelled by user' : 'Grader error',
        evidenceRefs: [events.at(-1)!.id],
      },
    ];
  }
  await ports.store.save('evidence.json', evidence);
  await ports.store.save('grades.json', grades);
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
  };
  await ports.store.save('manifest.json', manifest);
  return { evidence, grades, manifest };
}
