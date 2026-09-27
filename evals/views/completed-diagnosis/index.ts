import { createHash } from 'node:crypto';
import {
  matchesPiTool,
  normalizePiEvent,
  portablePiTool,
  visiblePiMessageText,
} from 'agent-evals/pi';
import {
  canonicalJson,
  type PreparedItem,
  type RecordedTrial,
  type TraceEvent,
  type View,
} from 'agent-evals';
import { fullOutput, resultFor, object, ordered, text, unique } from '../shared/evidence.ts';
import {
  diagnosisApplicability,
  message,
  probe,
  probeRefs,
  statedHypothesis,
  type DiagnosticEvidence,
  type ObservedProbe,
} from '../diagnosis/evidence.ts';

import { nonVerifyingArgument } from '../shared/verification-commands.ts';

/** Deliberately narrow selector: a literal package test, including Playwright, without shell chaining. */

function testAttempt(event: TraceEvent): boolean {
  const command = text(object(event.data.args).command);
  return (
    event.actor === 'agent' &&
    event.type === 'tool-call' &&
    event.data.name === 'bash' &&
    !/[;&|`$\r\n]/.test(command) &&
    !command.split(/\s+/).some((part) => nonVerifyingArgument.test(part)) &&
    /^(?:[A-Z_][A-Z0-9_]*=\S+\s+)*(?:pnpm|npm)\s+(?:exec\s+playwright\s+test|(?:run\s+)?test(?:[:\w-]+)?)(?:\s|$)/.test(
      command,
    )
  );
}

/** Repeated output lines occur once; ordered references reconstruct every byte. */

function compactProbeText(item: ObservedProbe): ObservedProbe {
  if (!item.result) {
    return item;
  }
  const dictionary: string[] = [];
  const indexes = new Map<string, number>();
  const order = item.result.text.split('\n').map((line) => {
    let index = indexes.get(line);
    if (index === undefined) {
      index = dictionary.length;
      indexes.set(line, index);
      dictionary.push(line);
    }
    return index;
  });
  const result = {
    ...item.result,
    text: 'Lossless output: join textLines.dictionary entries selected by textLines.order with newline.',
    textLines: {
      format: 'line-dictionary-v1' as const,
      dictionary,
      order,
      sha256: createHash('sha256').update(item.result.text).digest('hex'),
    },
  };
  return Buffer.byteLength(canonicalJson(result)) < Buffer.byteLength(canonicalJson(item.result))
    ? { ...item, result }
    : item;
}

/**
 * Audit a completed native prefix independently. Terminal gaps are exempted only
 * when their exact recorder-generated meaning is proven by events after the boundary.
 * Unknown recorder versions or additional gaps stay unknown, never absence failures.
 */

function completedPrefixGaps(
  trial: RecordedTrial,
  prefix: TraceEvent[],
  boundary: TraceEvent,
): string[] {
  const gaps: string[] = [];
  const adapter = trial.metadata.adapter;
  if (!['pi-recording-v1', 'pi-recording-v2'].includes(text(adapter))) {
    gaps.push('Completed-prefix coverage requires a known Pi recording format.');
  }
  if (
    trial.trace.events.some((event, index) => event.sequence !== index + 1) ||
    new Set(trial.trace.events.map((event) => event.id)).size !== trial.trace.events.length
  ) {
    gaps.push('The native recording sequence is not contiguous and unique.');
  }
  const digest = (value: string) => createHash('sha256').update(value).digest('hex');
  const environment = object(trial.metadata.environment);
  if (
    !trial.trace.contexts.length ||
    !Array.isArray(environment.contextCaptureGaps) ||
    environment.contextCaptureGaps.length
  ) {
    gaps.push('Historical context capture is unavailable or incomplete.');
  }
  for (const artifact of [...trial.trace.artifacts, ...trial.trace.contexts]) {
    if (digest(artifact.content) !== artifact.sha256) {
      gaps.push(`Recorded content fingerprint differs for ${artifact.id}.`);
    }
  }
  if (
    !prefix.some((event) => event.actor === 'evaluator' && event.data.type === 'pi_started') ||
    !prefix.some(
      (event) =>
        event.actor === 'evaluator' &&
        event.data.type === 'response' &&
        event.data.command === 'prompt' &&
        event.data.success === true,
    ) ||
    !prefix.some((event) => event.actor === 'agent' && event.data.type === 'agent_start')
  ) {
    gaps.push('The native prompt/start boundary is missing.');
  }
  const calls = new Map<string, TraceEvent>();
  const results = new Set<string>();
  for (const event of prefix) {
    const raw = object(event.source?.payload);
    if (!event.source || !Object.keys(raw).length) {
      gaps.push(`Native source is missing for ${event.id}.`);
      continue;
    }
    const nativeObservation = normalizePiEvent({ ...event, kind: 'pi', data: raw }).observation;
    const tool = portablePiTool(nativeObservation);
    const nativeMessage = object(raw.message);
    const nativeVisibleText = visiblePiMessageText(nativeMessage);
    const expectedType =
      tool?.type ??
      (raw.type === 'message_end' &&
      ['user', 'assistant'].includes(text(nativeMessage.role)) &&
      nativeVisibleText
        ? 'message'
        : undefined);
    if (expectedType && event.type !== expectedType) {
      gaps.push(`Observable native event was not represented at ${event.id}.`);
    }
    if (event.type === 'lifecycle' && canonicalJson(raw) !== canonicalJson(event.data)) {
      gaps.push(`Native lifecycle differs at ${event.id}.`);
    }
    if (event.type === 'message') {
      if (
        event.source.kind !== 'pi' ||
        raw.type !== 'message_end' ||
        nativeMessage.role !== event.data.role ||
        nativeVisibleText !== event.data.text ||
        event.data.partial
      ) {
        gaps.push(`Visible message coverage differs at ${event.id}.`);
      }
    }
    if (!['tool-call', 'tool-result'].includes(event.type)) {
      continue;
    }
    const key = `${event.actor}:${text(event.data.callId)}`;
    if (event.source.kind !== 'pi') {
      gaps.push(`Tool source is not native at ${event.id}.`);
    }
    if (event.type === 'tool-call') {
      if (calls.has(key)) {
        gaps.push(`Duplicate prefix call ${key}.`);
      }
      calls.set(key, event);
      if (!matchesPiTool(event, tool)) {
        gaps.push(`Native call differs at ${event.id}.`);
      }
    } else {
      if (!calls.has(key) || results.has(key)) {
        gaps.push(`Unmatched or duplicate prefix result ${key}.`);
      }
      results.add(key);
      if (
        tool?.type !== 'tool-result' ||
        tool.data.success === 'unknown' ||
        !matchesPiTool(event, tool)
      ) {
        gaps.push(`Native result differs or has unknown status at ${event.id}.`);
      }
      const capture = object(object(object(raw.result).details).evaluation).outputCapture;
      const retained = fullOutput(trial, event);
      if (
        object(capture).gap ||
        (object(capture).path &&
          (!retained ||
            retained.path !== object(capture).path ||
            retained.sha256 !== object(capture).sha256))
      ) {
        gaps.push(`Full output capture is incomplete at ${event.id}.`);
      }
      if (event.data.truncated && (!retained || object(capture).kind !== 'command-output')) {
        gaps.push(`Exact prefix tool output is truncated at ${event.id}.`);
      }
    }
  }
  for (const key of calls.keys()) {
    if (!results.has(key)) {
      gaps.push(`Prefix call ${key} has no completed result.`);
    }
  }
  const permitted = new Set<string>();
  const stop = trial.trace.events.find(
    (event) =>
      event.sequence > boundary.sequence &&
      event.actor === 'evaluator' &&
      event.data.type === 'stop_requested' &&
      event.data.reason === trial.status &&
      event.source?.payload !== undefined &&
      canonicalJson(event.source?.payload) === canonicalJson(event.data),
  );
  if (['budget_exceeded', 'timeout', 'cancelled'].includes(trial.status) && stop) {
    permitted.add(`Agent execution ended with ${trial.status}; later behavior is unobserved.`);
    if (!trial.trace.events.some((event) => event.data.type === 'agent_settled')) {
      permitted.add(
        'The recording has no native agent-settled boundary proving observable execution finished.',
      );
    }
    for (const call of trial.trace.events.filter(
      (event) => event.sequence > boundary.sequence && event.type === 'tool-call',
    )) {
      if (!resultFor(trial.trace.events, call)) {
        permitted.add(
          `Tool call ${adapter === 'pi-recording-v2' ? `${call.actor}:` : ''}${text(call.data.callId)} has no recorded result.`,
        );
      }
    }
  } else if (trial.status !== 'completed' || !trial.trace.complete) {
    gaps.push(
      'No observed terminal stop proves that interruption occurred after the completed prefix.',
    );
  }
  gaps.push(...trial.trace.gaps.filter((gap) => !permitted.has(gap)));
  if (!trial.trace.complete && !trial.trace.gaps.length) {
    gaps.push('The incomplete parent recording has no auditable gap descriptions.');
  }
  return unique(gaps);
}

export function prepareCompletedDiagnosis(
  trial: RecordedTrial,
): PreparedItem<DiagnosticEvidence>[] {
  const events = ordered(trial);
  const hypothesis = events.find(statedHypothesis);
  const attempt =
    hypothesis &&
    events.find((event) => event.sequence > hypothesis.sequence && testAttempt(event));
  const result = attempt && resultFor(events, attempt);
  const boundary =
    result &&
    events.find(
      (event) =>
        event.sequence > result.sequence &&
        event.actor === 'agent' &&
        event.source?.kind === 'pi' &&
        event.data.type === 'turn_end' &&
        object(event.source.payload).type === 'turn_end',
    );
  const prefix = boundary ? events.filter((event) => event.sequence <= boundary.sequence) : [];
  const observedProbes = hypothesis
    ? prefix
        .filter(
          (event) =>
            event.sequence > hypothesis.sequence &&
            event.actor === 'agent' &&
            event.type === 'tool-call',
        )
        .map((call) => probe(trial, prefix, call))
    : [];
  const probes = observedProbes.map((item) => {
    if (!item.result) {
      return item;
    }
    if (item.callRef !== attempt?.id) {
      // The complete recording and references retain these outputs for audit. The
      // scoped semantic input keeps every action and status. Relevance that depends
      // on omitted output remains uncertain rather than being inferred from a ref.
      return {
        ...item,
        result: {
          success: item.result.success,
          text: '',
          truncated: item.result.truncated,
          outputOmitted: true,
        },
      };
    }
    // Keep the selected test output exactly once. Truncated excerpts require the
    // saved full attachment; other attachments duplicate the visible result text.
    if (item.result.truncated) {
      return compactProbeText(item);
    }
    const { fullOutput: _attachment, ...result } = item.result;
    return compactProbeText({ ...item, result });
  });
  const conversation = prefix
    .filter(
      (event) =>
        event.type === 'message' && event.data.role !== 'system' && event.id !== hypothesis?.id,
    )
    .map(message);
  const observedHypothesis = hypothesis
    ? { ...message(hypothesis), sequence: hypothesis.sequence }
    : null;
  const earlier = hypothesis
    ? prefix.filter(
        (event) =>
          event.sequence < hypothesis.sequence && ['tool-call', 'tool-result'].includes(event.type),
      )
    : [];
  const excluded = boundary
    ? events.filter(
        (event) =>
          event.sequence > boundary.sequence &&
          ['message', 'tool-call', 'tool-result'].includes(event.type),
      )
    : [];
  const gaps = boundary
    ? completedPrefixGaps(trial, prefix, boundary)
    : [
        'A first diagnostic statement, completed literal testing attempt and native turn-end boundary were not all captured.',
      ];
  return [
    {
      id: 'first-completed-diagnostic-attempt',
      data: {
        task: conversation.some(
          (item) => item.role === 'user' && item.text.startsWith(trial.task.prompt),
        )
          ? 'Task prompt is retained verbatim in the user conversation below.'
          : trial.task.prompt,
        extraction: 'explicit_episode',
        hypothesis: observedHypothesis,
        selectedTestCallRef: boundary ? (attempt?.id ?? null) : null,
        conversation,
        priorResult: null,
        probes,
      },
      scope: `Initial hypothesis, every tool call's arguments/status, and selected literal test output through native turn-end (${boundary?.id ?? 'unavailable'}); selected test call ${boundary ? attempt?.id : 'unavailable'}. Continuity audited from native start. This is not a judgment of the whole trial or eventual repair.`,
      sourceRefs: unique([
        ...(hypothesis ? [hypothesis.id] : []),
        ...conversation.map((item) => item.sourceRef),
        ...observedProbes.flatMap(probeRefs),
        ...earlier.map((event) => event.id),
        ...(boundary ? [boundary.id] : []),
      ]),
      coverage: { complete: gaps.length === 0, gaps },
      omissions: [
        `${earlier.length} earlier tool event refs are in sourceRefs; text omitted, relevance unassessed.`,
        `Intermediate tool result text is omitted from semantic input for ${observedProbes.filter((item) => item.callRef !== attempt?.id && item.result).length} results; their call arguments, status, result refs and any full-output attachment refs remain auditable in the recording. Their relevance is unassessed where output matters; use unknown when omissions prevent a decision. Selected test output is retained exactly.`,
        `Later activity is excluded, including any later contradictions or repairs; excluded visible/tool refs: ${excluded.map((event) => event.id).join(', ') || '(none)'}.`,
        `The parent trial remains ${trial.status}, complete=${trial.trace.complete}; parent gaps retained: ${JSON.stringify(trial.trace.gaps)}.`,
        `${trial.trace.contexts.length} contexts audited for coverage only; text omitted from semantic grading, identities in trial.trace.contexts.`,
        'Hypothesis appears once at its sequence, outside other conversation. Hidden reasoning and redundant attachments omitted. Repeated output lines use lossless line-dictionary-v1: join dictionary[order[i]] with newline, including empty lines. No selected output is dropped. Semantic uncertainty requires unknown.',
      ],
      applicability: diagnosisApplicability(trial),
    },
  ];
}

export const completedDiagnosis: View<DiagnosticEvidence> = {
  id: 'completedDiagnosis',
  version: 2,
  prepare: prepareCompletedDiagnosis,
};
