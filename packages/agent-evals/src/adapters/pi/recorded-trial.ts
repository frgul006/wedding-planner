import { createHash } from 'node:crypto';
import type { RecordedTrial, TraceArtifact, TraceEvent } from '../../core/types.ts';
import type { Artifact, EvidenceEvent, TrialEvidence } from './types.ts';
import { normalizePiEvent, portablePiTool, visiblePiMessageText } from './pi-evidence.ts';

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** Reasoning is not observable user/assistant speech. Keep an explicit omission marker. */
export function observableNativePayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(observableNativePayload);
  if (value === null || typeof value !== 'object') return value;
  const record = object(value);
  if (
    typeof record.type === 'string' &&
    /^(thinking|reasoning|redacted_thinking)(_|$)/.test(record.type)
  )
    return { type: 'reasoning-omitted' };
  return Object.fromEntries(
    Object.entries(record).map(([key, field]) => [key, observableNativePayload(field)]),
  );
}

function isFinalVisibleUpdate(
  event: EvidenceEvent,
  index: number,
  events: EvidenceEvent[],
): boolean {
  if (event.data.type !== 'message_update') return false;
  for (const next of events.slice(index + 1)) {
    if (next.data.type === 'message_end' || next.data.type === 'message_update') return false;
    if (next.data.type === 'message_start') break;
  }
  return true;
}

/** Translate saved observations only. Never consult today's files to fill historical gaps. */
export function recordedTrialFromEvidence(
  id: string,
  original: TrialEvidence,
  environment: Record<string, unknown> = {},
): RecordedTrial {
  const evidence = { ...original, events: original.events.map(normalizePiEvent) };
  const gaps: string[] = [];
  if (evidence.agent.status !== 'completed')
    gaps.push(`Agent execution ended with ${evidence.agent.status}; later behavior is unobserved.`);
  if (!evidence.events.some((event) => event.data.type === 'agent_settled'))
    gaps.push(
      'The recording has no native agent-settled boundary proving observable execution finished.',
    );
  const artifactIds = new Set<string>();
  const artifacts: TraceArtifact[] = [];
  const artifactsByOriginalId = new Map<string, TraceArtifact[]>();
  const retainArtifact = (artifact: Artifact): string => {
    const sha256 = hash(artifact.content);
    if (sha256 !== artifact.sha256)
      gaps.push(
        `Artifact ${artifact.id} differs from its recorded fingerprint (possibly capture redaction).`,
      );
    const previous = artifactsByOriginalId
      .get(artifact.id)
      ?.find((saved) => saved.path === artifact.path && saved.content === artifact.content);
    if (previous) return previous.id;
    let artifactId = artifact.id;
    let suffix = artifacts.length + 1;
    while (artifactIds.has(artifactId)) artifactId = `${artifact.id}-${suffix++}`;
    artifactIds.add(artifactId);
    const saved = { id: artifactId, path: artifact.path, content: artifact.content, sha256 };
    artifacts.push(saved);
    artifactsByOriginalId.set(artifact.id, [
      ...(artifactsByOriginalId.get(artifact.id) ?? []),
      saved,
    ]);
    return artifactId;
  };
  for (const artifact of evidence.beforeArtifacts ?? []) retainArtifact(artifact);
  const finalArtifactIds = evidence.artifacts.map(retainArtifact);
  const patchId = evidence.patch ? retainArtifact(evidence.patch) : undefined;
  const contexts: RecordedTrial['trace']['contexts'] = [];
  const { recordedContexts: rawContexts, ...environmentMetadata } = environment;
  let contextExtractionLossy = rawContexts !== undefined && !Array.isArray(rawContexts);
  if (!Array.isArray(rawContexts) || rawContexts.length === 0)
    gaps.push(
      'Historical instruction and skill contents were not captured; current files cannot replace them.',
    );
  else
    for (const raw of rawContexts) {
      const context = object(raw);
      if (
        typeof context.id !== 'string' ||
        typeof context.path !== 'string' ||
        typeof context.kind !== 'string' ||
        typeof context.content !== 'string' ||
        typeof context.sha256 !== 'string'
      ) {
        contextExtractionLossy = true;
        gaps.push('A historical context record is incomplete.');
        continue;
      }
      const sha256 = hash(context.content);
      if (sha256 !== context.sha256) {
        contextExtractionLossy = true;
        gaps.push(`Historical context ${context.id} differs from its recorded fingerprint.`);
      }
      if (
        Object.keys(context).some(
          (key) => !['id', 'path', 'kind', 'content', 'sha256'].includes(key),
        )
      )
        contextExtractionLossy = true;
      contexts.push({
        id: context.id,
        path: context.path,
        kind: context.kind,
        content: context.content,
        sha256,
      });
    }
  if (Array.isArray(environment.contextCaptureGaps))
    gaps.push(
      ...environment.contextCaptureGaps.filter((gap): gap is string => typeof gap === 'string'),
    );
  const started = new Set<string>();
  const finished = new Set<string>();
  const events: TraceEvent[] = evidence.events.map((event, index) => {
    const source = { kind: event.kind, payload: observableNativePayload(event.data) };
    const base = {
      id: event.id,
      sequence: event.sequence,
      timestamp: event.timestamp,
      actor: event.actor,
      source,
    };
    const tool = portablePiTool(event.observation);
    if (tool?.type === 'tool-call') {
      const key = `${event.actor}:${tool.data.callId}`;
      if (started.has(key)) gaps.push(`Duplicate tool call identifier: ${key}.`);
      started.add(key);
      return { ...base, ...tool };
    }
    if (tool?.type === 'tool-result') {
      const key = `${event.actor}:${tool.data.callId}`;
      if (finished.has(key)) gaps.push(`Duplicate tool result identifier: ${key}.`);
      finished.add(key);
      if (!started.has(key))
        gaps.push(`Tool result ${key} has no recorded call from the same actor.`);
      const result = object(event.data.result);
      const outputCapture = object(object(object(result.details).evaluation).outputCapture);
      const fullOutput = artifacts.find(
        (artifact) =>
          artifact.path === outputCapture.path && artifact.sha256 === outputCapture.sha256,
      );
      if (typeof outputCapture.gap === 'string') gaps.push(`${event.id}: ${outputCapture.gap}`);
      if (outputCapture.path && !fullOutput)
        gaps.push(
          `${event.id}: The full native output attachment is missing or has a mismatched hash.`,
        );
      if (tool.data.truncated && (!fullOutput || outputCapture.kind !== 'command-output'))
        gaps.push(
          `${event.id}: Native tool output was truncated;${fullOutput ? ' the full source file is retained, but the exact omitted tool output is unavailable.' : ' the full output was not captured.'}`,
        );
      if (outputCapture.encoding === 'base64')
        gaps.push(
          `${event.id}: Binary native output is retained as base64 and is not represented as text.`,
        );
      return {
        ...base,
        ...tool,
        data: {
          ...tool.data,
          ...(fullOutput ? { fullOutputRef: fullOutput.id, outputCapture } : {}),
        },
      };
    }
    const partial = isFinalVisibleUpdate(event, index, evidence.events);
    if (event.data.type === 'message_end' || partial) {
      const message = object(event.data.message);
      const text = visiblePiMessageText(message);
      if ((message.role === 'assistant' || message.role === 'user') && text) {
        if (partial) gaps.push(`${event.id}: Only a partial observable message was captured.`);
        return {
          ...base,
          type: 'message',
          data: { role: message.role, text, ...(partial ? { partial: true } : {}) },
        };
      }
    }
    return { ...base, type: 'lifecycle', data: object(observableNativePayload(event.data)) };
  });
  for (const callId of started)
    if (!finished.has(callId)) gaps.push(`Tool call ${callId} has no recorded result.`);
  const uniqueGaps = [...new Set(gaps)];
  const { id: taskId, version, prompt, metadata, ...legacyTaskFields } = evidence.task;
  return {
    id,
    task: {
      id: taskId,
      version,
      prompt,
      metadata: { ...legacyTaskFields, ...metadata },
    },
    status: evidence.agent.status,
    trace: { events, artifacts, contexts, complete: uniqueGaps.length === 0, gaps: uniqueGaps },
    outcome: {
      ...(evidence.localUrl ? { localUrl: evidence.localUrl } : {}),
      changedFiles: evidence.changedFiles ?? [],
      checks: evidence.checks ?? [],
      artifacts: finalArtifactIds,
      patch: patchId,
      usage: evidence.agent.usage,
      limits: evidence.agent.limits,
      limitUsage: evidence.agent.limitUsage,
      limitHit: evidence.agent.limitHit,
      error: evidence.agent.error,
    },
    metadata: {
      adapter: 'pi-recording-v2',
      variant: evidence.variant,
      model: evidence.agent.model,
      thinkingLevel: evidence.agent.thinkingLevel,
      startedAt: evidence.agent.startedAt,
      endedAt: evidence.agent.endedAt,
      environment: {
        ...environmentMetadata,
        ...(contextExtractionLossy ? { recordedContexts: rawContexts } : {}),
      },
      omissions: ['Hidden reasoning is excluded from portable messages and source payloads.'],
    },
  };
}
