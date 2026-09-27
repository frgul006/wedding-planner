import { createHash } from 'node:crypto';
import { normalizePiEvent } from '../adapters/pi-evidence.ts';
import { parsePlaywrightOutput } from '../adapters/playwright-evidence.ts';
import { canonicalJson } from '../application/serialization.ts';
import type { RecordedTrial, TraceArtifact, TraceEvent } from '../domain/library.ts';
import type { BrowserOutput } from '../domain/types.ts';
import { parseBrowserSnapshotChain } from './browser-command-chain.ts';

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as ObjectValue)
    : {};
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const same = (left: unknown, right: unknown) =>
  canonicalJson({ value: left }) === canonicalJson({ value: right });

export interface ChainedBrowserSnapshot {
  unknown?: string;
  output?: TraceArtifact;
  browser?: BrowserOutput;
  /** Derived from retained native output, not an invented saved snapshot artifact. */
  snapshot?: { content: string; sha256: string; sourceRef: string };
}

/** Interpret a supported literal chain using only its independently retained native output. */
export function extractChainedBrowserSnapshot(
  trial: RecordedTrial,
  call: TraceEvent,
  result: TraceEvent | undefined,
): ChainedBrowserSnapshot | undefined {
  const command = object(call.data.args).command;
  if (typeof command !== 'string' || !parseBrowserSnapshotChain(command)) return;
  const unknown = (message: string): ChainedBrowserSnapshot => ({ unknown: message });
  if (
    call.actor !== 'agent' ||
    call.type !== 'tool-call' ||
    call.data.name !== 'bash' ||
    !result ||
    result.actor !== call.actor ||
    result.type !== 'tool-result' ||
    result.sequence <= call.sequence ||
    result.data.callId !== call.data.callId ||
    typeof call.data.callId !== 'string' ||
    !call.data.callId ||
    [call, result].some(
      (event) =>
        trial.trace.events.filter((saved) => saved.id === event.id).length !== 1 ||
        !trial.trace.events.some((saved) => saved.id === event.id && same(saved, event)),
    ) ||
    ['tool-call', 'tool-result'].some(
      (type) =>
        trial.trace.events.filter(
          (event) =>
            event.actor === call.actor &&
            event.type === type &&
            event.data.callId === call.data.callId,
        ).length !== 1,
    )
  )
    return unknown('The browser chain lacks a unique, ordered agent call/result pair.');
  if (call.source?.kind !== 'pi' || result.source?.kind !== 'pi')
    return unknown('Native Pi source is unavailable for the browser chain.');
  const rawCall = object(call.source.payload);
  const rawResult = object(result.source.payload);
  const started = normalizePiEvent({ ...call, kind: 'pi', data: rawCall }).observation;
  const completed = normalizePiEvent({ ...result, kind: 'pi', data: rawResult }).observation;
  if (
    started?.type !== 'tool_started' ||
    completed?.type !== 'tool_completed' ||
    completed.success === 'unknown' ||
    (rawResult.toolName !== undefined && rawResult.toolName !== 'bash') ||
    !same({ callId: started.callId, name: started.name, args: started.args }, call.data) ||
    !same(
      {
        callId: completed.callId,
        success: completed.success,
        text: completed.text,
        truncated: completed.truncated,
        receipt: completed.receipt,
      },
      {
        callId: result.data.callId,
        success: result.data.success,
        text: result.data.text,
        truncated: result.data.truncated,
        receipt: result.data.receipt,
      },
    ) ||
    completed.receipt.kind !== 'bash'
  )
    return unknown('The browser chain differs from its native command/result attestation.');
  // An attested failure does not need a successful snapshot to establish failure.
  if (!completed.success || completed.receipt.exitCode !== 0) return {};

  const capture = object(object(object(rawResult.result).details).evaluation).outputCapture;
  const descriptor = object(capture);
  const outputs = trial.trace.artifacts.filter((item) => item.id === result.data.fullOutputRef);
  const output = outputs[0];
  if (
    !same(capture, result.data.outputCapture) ||
    descriptor.gap !== undefined ||
    descriptor.kind !== 'command-output' ||
    descriptor.encoding !== 'utf8' ||
    descriptor.path !== `native-output:${call.data.callId}` ||
    typeof descriptor.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(descriptor.sha256) ||
    outputs.length !== 1 ||
    !output ||
    output.path !== descriptor.path ||
    output.sha256 !== descriptor.sha256 ||
    hash(output.content) !== output.sha256
  )
    return unknown('The browser chain lacks hash-verified native UTF-8 command output.');

  const browser = parsePlaywrightOutput(output.content);
  const content = browser.finalInlineSnapshot;
  // Require the last actual Page section to belong to the explicit final snapshot.
  // Earlier navigation reports cannot lend a URL to a later unlabelled snapshot.
  const lastPage = [...output.content.matchAll(/^### Page\r?$/gm)].at(-1);
  const suffix = lastPage ? output.content.slice(lastPage.index) : '';
  const paired = suffix.match(
    /^### Page\r?\n- Page URL: ([^\s]+)\r?\n(?:- Page Title: [^\r\n]*\r?\n)?### Snapshot\r?\n```yaml\r?\n([\s\S]*?)\r?\n```(?:\r?\n)?$/,
  );
  if (!content || !paired || paired[2] !== content || browser.pageUrls.at(-1) !== paired[1])
    return {
      output,
      unknown: 'The retained output lacks a final explicit snapshot paired with its own Page URL.',
    };
  return {
    output,
    browser,
    snapshot: { content, sha256: hash(content), sourceRef: output.id },
  };
}
