import { createHash } from 'node:crypto';
import type {
  EvaluationObservation,
  EvidenceEvent,
  SnapshotReceipt,
  TargetFingerprint,
  ToolReceipt,
  TrialEvidence,
} from '../domain/types.ts';
import { parsePlaywrightOutput } from './playwright-evidence.ts';

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const isHash = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const isPath = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && !value.includes('\0');

function targetFingerprint(receipt: Record<string, unknown>): TargetFingerprint | undefined {
  const result: TargetFingerprint = {};
  for (const field of ['targetBeforeHash', 'targetAfterHash'] as const) {
    const value = receipt[field];
    if (value === undefined) continue; // A missing/deleted target is unobserved.
    if (!isHash(value)) return;
    result[field] = value;
  }
  return result;
}

function snapshotReceipt(value: unknown, callId: string): SnapshotReceipt | undefined {
  const snapshot = object(value);
  if (
    !isPath(snapshot.path) ||
    typeof snapshot.content !== 'string' ||
    !snapshot.content ||
    !isHash(snapshot.sha256)
  )
    return;
  if (createHash('sha256').update(snapshot.content).digest('hex') !== snapshot.sha256) return;
  if (snapshot.path === `tool-output:${callId}`) {
    return {
      source: 'tool-output',
      path: snapshot.path,
      content: snapshot.content,
      sha256: snapshot.sha256,
    };
  }
  if (
    !/^\.playwright-cli\/[^\s\\]+\.ya?ml$/i.test(snapshot.path) ||
    snapshot.path.split('/').some((part) => part === '.' || part === '..')
  )
    return;
  return {
    source: 'file',
    path: snapshot.path,
    content: snapshot.content,
    sha256: snapshot.sha256,
  };
}

/** Missing/invalid attestation is explicit; native success alone cannot replace it. */
export function normalizeToolReceipt(value: unknown, text: string, callId: string): ToolReceipt {
  const raw = object(value);
  if (!Object.keys(raw).length) return { kind: 'unknown', reason: 'missing' };
  const kind = raw.kind;
  if (typeof kind !== 'string') return { kind: 'unknown', reason: 'malformed' };
  if (!['file-read', 'file-edit', 'file-write', 'bash', 'playwright-cli'].includes(kind)) {
    return { kind: 'unknown', reason: 'unsupported' };
  }
  const malformed: ToolReceipt = { kind: 'unknown', reason: 'malformed' };
  const target = targetFingerprint(raw);
  if (!target) return malformed;
  if (kind === 'file-read') {
    if (!isPath(raw.path) || !isHash(raw.sha256)) return malformed;
    return { kind, path: raw.path, sha256: raw.sha256, ...target };
  }
  if (kind === 'file-edit' || kind === 'file-write') {
    if (!isPath(raw.path)) return malformed;
    return { kind, path: raw.path, ...target };
  }
  if (typeof raw.exitCode !== 'number' || !Number.isInteger(raw.exitCode) || raw.exitCode < 0)
    return malformed;
  const browser = parsePlaywrightOutput(text);
  if (kind === 'bash') return { kind, exitCode: raw.exitCode, browser, ...target };
  if (
    !Array.isArray(raw.args) ||
    !raw.args.length ||
    !raw.args.every((arg) => typeof arg === 'string' && arg.length > 0 && !arg.includes('\0'))
  )
    return malformed;
  const snapshot = raw.snapshot === undefined ? undefined : snapshotReceipt(raw.snapshot, callId);
  if (raw.snapshot !== undefined && !snapshot) return malformed;
  return {
    kind: 'playwright-cli',
    args: raw.args,
    exitCode: raw.exitCode,
    browser,
    ...target,
    ...(snapshot ? { snapshot } : {}),
  };
}

/** Pi 0.85.1 discovery uses sourceInfo.path; older recordings used path. */
function discoveredSkills(commands: unknown[]): Array<{ path: string; name?: string }> {
  return commands.flatMap((value) => {
    const command = object(value);
    const path = object(command.sourceInfo).path ?? command.path;
    if (command.source !== 'skill' || typeof path !== 'string') return [];
    return [
      {
        path,
        ...(typeof command.name === 'string' ? { name: command.name.replace(/^skill:/, '') } : {}),
      },
    ];
  });
}

/** Native framing, result flags and tool output are decoded only at this seam. */
export function normalizePiEvent(event: EvidenceEvent): EvidenceEvent {
  if (event.kind !== 'pi') return event;
  const data = event.data;
  let observation: EvaluationObservation | undefined;
  if (data.type === 'response' && data.command === 'get_commands' && data.success === true) {
    const commands = object(data.data).commands;
    if (Array.isArray(commands))
      observation = { type: 'skills_discovered', skills: discoveredSkills(commands) };
  } else if (typeof data.toolCallId === 'string') {
    if (data.type === 'tool_execution_start') {
      observation = {
        type: 'tool_started',
        callId: data.toolCallId,
        name: typeof data.toolName === 'string' ? data.toolName : '',
        args: object(data.args),
      };
    } else if (data.type === 'tool_execution_end') {
      const result = object(data.result);
      const details = object(result.details);
      const text = (Array.isArray(result.content) ? result.content : [])
        .flatMap((value) => {
          const block = object(value);
          return block.type === 'text' && typeof block.text === 'string' ? [block.text] : [];
        })
        .join('\n');
      observation = {
        type: 'tool_completed',
        callId: data.toolCallId,
        success:
          typeof data.isError !== 'boolean' ||
          (result.isError !== undefined && typeof result.isError !== 'boolean')
            ? 'unknown'
            : data.isError === false && result.isError !== true,
        text,
        textSha256: createHash('sha256').update(text).digest('hex'),
        truncated: object(details.truncation).truncated === true,
        receipt: normalizeToolReceipt(details.evaluation, text, data.toolCallId),
      };
    }
  }
  // Ignore serialized observations for native messages: derive from their source.
  const { observation: _previous, ...raw } = event;
  return observation ? { ...raw, observation } : raw;
}

/**
 * Upgrade saved evidence in memory. IDs, order and raw data stay unchanged, so
 * original seals and references still identify the original recording on disk.
 */
export function normalizeLegacyEvidence(evidence: TrialEvidence): TrialEvidence {
  return {
    ...evidence,
    agent: { ...evidence.agent, events: evidence.agent.events.map(normalizePiEvent) },
    events: evidence.events.map(normalizePiEvent),
  };
}
