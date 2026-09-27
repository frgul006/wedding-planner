import { canonicalJson, type PreparedItem, type RecordedTrial } from 'agent-evals';
import { coverage, unique } from '../shared/evidence.ts';
import {
  diagnosisApplicability,
  probeGaps,
  probeRefs,
  type DiagnosticEvidence,
  type ObservedMessage,
  type ObservedProbe,
} from './evidence.ts';

/** Leave space beneath Jev's character and conservative byte/context limits. */
const STATE_BUDGET_CHARS = 17_500;
const STATE_BUDGET_BYTES = 24_000;

interface EpisodeUnit {
  sequence: number;
  conversation?: ObservedMessage;
  probe?: ObservedProbe;
  refs: string[];
  gap?: string;
}

export function compactProbe(observed: ObservedProbe): ObservedProbe {
  const result = observed.result;
  if (!result?.fullOutput) {
    return observed;
  }
  const { fullOutput, text } = result;
  if (fullOutput.content === text && !result.truncated) {
    // The exact output is already in result.text. Keep the artifact in sourceRefs.
    return { ...observed, result: { ...result, fullOutput: undefined } };
  }
  const embedded = text.indexOf(fullOutput.content);
  if (embedded >= 0) {
    return {
      ...observed,
      result: {
        ...result,
        text: '',
        textParts: {
          prefix: text.slice(0, embedded),
          suffix: text.slice(embedded + fullOutput.content.length),
          fullOutputRef: fullOutput.id,
        },
      },
    };
  }
  return observed;
}

function oversizedMarker(unit: EpisodeUnit, omitArgs = false): EpisodeUnit {
  if (unit.conversation) {
    return {
      ...unit,
      conversation: { ...unit.conversation, text: '', textOmitted: true },
      gap: `Message ${unit.conversation.sourceRef} exceeds the submitted evidence limit; exact text remains in the recording.`,
    };
  }
  const original = unit.probe!;
  return {
    ...unit,
    probe: {
      ...original,
      args: omitArgs ? {} : original.args,
      result: original.result
        ? {
            success: original.result.success,
            text: '',
            truncated: original.result.truncated,
            outputOmitted: true,
          }
        : null,
    },
    gap: `Tool ${original.callRef} exceeds the submitted evidence limit; exact result${omitArgs ? ' and arguments' : ''} remains in the recording.`,
  };
}

export function prepareEpisode(
  trial: RecordedTrial,
  episodeId: string,
  extraction: DiagnosticEvidence['extraction'],
  hypothesis: ObservedMessage | null,
  conversation: ObservedMessage[],
  observedProbes: ObservedProbe[],
  priorResult: DiagnosticEvidence['priorResult'],
  priorRefs: string[],
  priorGap?: string,
): PreparedItem<DiagnosticEvidence>[] {
  const units: EpisodeUnit[] = [
    ...conversation.map((item) => ({
      sequence: item.sequence ?? 0,
      conversation: item,
      refs: [item.sourceRef],
    })),
    ...observedProbes.map((item) => ({
      sequence: item.sequence ?? 0,
      probe: compactProbe(item),
      refs: probeRefs(item),
    })),
  ].sort((left, right) => left.sequence - right.sequence);

  const build = (
    selected: EpisodeUnit[],
    index: number,
    count: number,
    extraGaps: string[] = [],
  ): PreparedItem<DiagnosticEvidence> => {
    const probes = selected.flatMap((unit) => (unit.probe ? [unit.probe] : []));
    const first = selected[0]?.sequence;
    const last = selected.at(-1)?.sequence;
    const gaps = unique([
      ...probeGaps(probes),
      ...selected.flatMap((unit) => (unit.gap ? [unit.gap] : [])),
      ...(index === 0 && priorGap ? [priorGap] : []),
      ...extraGaps,
    ]);
    return {
      id: `${episodeId}-segment-${index + 1}`,
      data: {
        task: trial.task.prompt,
        episodeId,
        chunkIndex: index + 1,
        chunkCount: count,
        extraction,
        hypothesis,
        conversation: selected.flatMap((unit) => (unit.conversation ? [unit.conversation] : [])),
        priorResult: index === 0 ? priorResult : null,
        probes,
      },
      sourceRefs: unique([
        ...(hypothesis ? [hypothesis.sourceRef] : []),
        ...(index === 0 ? priorRefs : []),
        ...selected.flatMap((unit) => unit.refs),
      ]),
      scope: `Diagnostic episode ${episodeId}, segment ${index + 1}/${count}; ordered event sequences ${first ?? 'none'}–${last ?? 'none'}. All segments together cover the episode.`,
      coverage: coverage(trial, gaps),
      omissions: [
        'Other episode events are in sibling segments; this segment contains complete selected messages and tool calls/results unless a coverage gap says otherwise. Hidden reasoning is unobservable.',
        'Duplicate output bytes are represented once. textParts reconstructs result text as prefix + fullOutput.content + suffix. The exact attachment remains linked in sourceRefs.',
        ...(index === 0 ? [] : ['The preceding result is in the first segment of this episode.']),
      ],
      applicability: diagnosisApplicability(trial),
    };
  };

  const fits = (selected: EpisodeUnit[], index: number, gaps: string[] = []) => {
    const item = build(selected, index, 99999, gaps);
    const { data, scope, sourceRefs, coverage, omissions, applicability } = item;
    const state = canonicalJson({
      data,
      scope,
      sourceRefs,
      coverage,
      omissions,
      applicability,
      view: { id: 'diagnosis', version: 2 },
      serializationVersion: 'canonical-json-v1',
    });
    return state.length <= STATE_BUDGET_CHARS && Buffer.byteLength(state) <= STATE_BUDGET_BYTES;
  };

  // A huge common frame cannot be repeated safely. Preserve provenance and
  // explicitly mark uncertainty instead of judging an unanchored fragment.
  const frameGap = !fits([], 0)
    ? [
        `The task, hypothesis, or preceding result exceeds the submitted evidence limit for ${episodeId}.`,
      ]
    : [];
  if (frameGap.length) {
    const item = build([], 0, 1, frameGap);
    item.data.task = '';
    item.data.hypothesis = hypothesis ? { ...hypothesis, text: '', textOmitted: true } : null;
    item.data.priorResult = null;
    item.sourceRefs = unique([...item.sourceRefs, ...units.flatMap((unit) => unit.refs)]);
    item.scope = `Diagnostic episode ${episodeId}; common frame exceeds the evidence limit, so no episode unit is submitted.`;
    item.omissions.push(
      `${units.length} ordered conversation/tool units and the common frame remain in the source recording; none are submitted to the judge.`,
    );
    return [item];
  }

  const chunks: EpisodeUnit[][] = [];
  let pending: EpisodeUnit[] = [];
  const flush = () => {
    if (pending.length) {
      chunks.push(pending);
    }
    pending = [];
  };
  for (const unit of units) {
    if (fits([...pending, unit], chunks.length)) {
      pending.push(unit);
      continue;
    }
    flush();
    if (fits([unit], chunks.length)) {
      pending.push(unit);
      continue;
    }
    const marker = oversizedMarker(unit);
    chunks.push([fits([marker], chunks.length) ? marker : oversizedMarker(unit, true)]);
  }
  flush();
  if (!chunks.length) {
    chunks.push([]);
  }

  return chunks.map((chunk, index) => build(chunk, index, chunks.length));
}
