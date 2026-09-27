import type { RecordedTrial, TraceArtifact, TraceEvent } from 'agent-evals';

export type ObjectValue = Record<string, unknown>;

export const object = (value: unknown): ObjectValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as ObjectValue)
    : {};

export const text = (value: unknown): string => (typeof value === 'string' ? value : '');

export const unique = (values: string[]) => [...new Set(values)];

export const ordered = (trial: RecordedTrial) =>
  [...trial.trace.events].sort((left, right) => left.sequence - right.sequence);

export function resultFor(events: TraceEvent[], call: TraceEvent): TraceEvent | undefined {
  return events.find(
    (event) =>
      event.actor === call.actor &&
      event.type === 'tool-result' &&
      event.data.callId === call.data.callId &&
      event.sequence > call.sequence,
  );
}

export function fullOutput(
  trial: RecordedTrial,
  result: TraceEvent | undefined,
): TraceArtifact | undefined {
  if (object(result?.data.outputCapture).encoding !== 'utf8') {
    return;
  }
  return trial.trace.artifacts.find((artifact) => artifact.id === result?.data.fullOutputRef);
}

export function coverage(trial: RecordedTrial, gaps: string[]) {
  const all = unique([
    ...trial.trace.gaps,
    ...(!trial.trace.complete
      ? ['The runner did not attest a complete observable recording.']
      : []),
    ...gaps,
  ]);
  return { complete: trial.trace.complete && all.length === 0, gaps: all };
}
