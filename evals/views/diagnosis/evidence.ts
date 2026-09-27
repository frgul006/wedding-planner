import type { PreparedItem, RecordedTrial, TraceArtifact, TraceEvent } from 'agent-evals';
import { fullOutput, object, resultFor, text, type ObjectValue } from '../shared/evidence.ts';

export interface ObservedMessage {
  sourceRef: string;
  role: string;
  text: string;
}

export interface ObservedProbe {
  callRef: string;
  resultRef?: string;
  name: string;
  args: ObjectValue;
  result: {
    success: boolean | 'unknown';
    text: string;
    truncated: boolean;
    fullOutput?: TraceArtifact;
    textLines?: {
      format: 'line-dictionary-v1';
      dictionary: string[];
      order: number[];
      sha256: string;
    };
  } | null;
}

export interface DiagnosticEvidence {
  task: string;
  extraction: 'explicit_episode' | 'unparsed_recording';
  hypothesis: ObservedMessage | null;
  conversation: ObservedMessage[];
  priorResult: ObservedProbe['result'];
  probes: ObservedProbe[];
}

export function message(event: TraceEvent): ObservedMessage {
  return { sourceRef: event.id, role: text(event.data.role), text: text(event.data.text) };
}

export function probe(trial: RecordedTrial, events: TraceEvent[], call: TraceEvent): ObservedProbe {
  const result = resultFor(events, call);
  const retained = fullOutput(trial, result);
  return {
    callRef: call.id,
    ...(result ? { resultRef: result.id } : {}),
    name: text(call.data.name),
    args: object(call.data.args),
    result: result
      ? {
          success: typeof result.data.success === 'boolean' ? result.data.success : 'unknown',
          text: text(result.data.text),
          truncated: result.data.truncated === true,
          ...(retained ? { fullOutput: retained } : {}),
        }
      : null,
  };
}

export function probeGaps(probes: ObservedProbe[]): string[] {
  return probes.flatMap((item) => [
    ...(!item.result ? [`Missing result for ${item.callRef}.`] : []),
    ...(item.result?.truncated && !item.result.fullOutput
      ? [`Truncated result for ${item.callRef}.`]
      : []),
    ...(item.result?.success === 'unknown' ? [`Unknown tool status for ${item.callRef}.`] : []),
  ]);
}

export function diagnosisApplicability(trial: RecordedTrial): PreparedItem['applicability'] {
  const requirement = trial.task.metadata?.diagnosis;
  return requirement === 'required'
    ? 'applicable'
    : requirement === 'not_required'
      ? 'not_applicable'
      : 'unknown';
}

export const statedHypothesis = (event: TraceEvent) =>
  event.actor === 'agent' &&
  event.type === 'message' &&
  event.data.role === 'assistant' &&
  /\bhypothes(?:is|es)\b|\bif\b[\s\S]*\bthen\b|\b(?:I suspect|may be|might be|could be)\b/i.test(
    text(event.data.text),
  );

export function probeRefs(item: ObservedProbe): string[] {
  return [
    item.callRef,
    ...(item.resultRef ? [item.resultRef] : []),
    ...(item.result?.fullOutput ? [item.result.fullOutput.id] : []),
  ];
}
