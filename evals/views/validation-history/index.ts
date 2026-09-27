import type {
  CheckResult,
  CodeGrader,
  PreparedItem,
  RecordedTrial,
  TraceArtifact,
  View,
} from 'agent-evals';
import { extractChainedBrowserSnapshot } from './chained-browser-evidence.ts';
import { classifyVerificationCommand } from '../shared/verification-commands.ts';
import {
  coverage,
  fullOutput,
  object,
  ordered,
  resultFor,
  text,
  unique,
  type ObjectValue,
} from '../shared/evidence.ts';
import { nonVerifyingArgument } from '../shared/verification-commands.ts';

export type ValidationCheck = 'test' | 'lint' | 'build' | 'browser_snapshot';

interface ValidationAction {
  callRef: string;
  resultRef?: string;
  sequence: number;
  startedSequence: number;
  kind: ValidationCheck | 'edit';
  success: boolean | 'unknown';
  beforeHash?: string;
  afterHash?: string;
  browserValid?: boolean;
  unknown?: string;
  name: string;
  args: ObjectValue;
  resultText: string;
  receipt: ObjectValue;
  snapshotArtifact?: TraceArtifact;
  /** An explicit terminal snapshot inside the exact retained command output. */
  inlineSnapshot?: { content: string; sha256: string; sourceRef: string };
  fullOutput?: TraceArtifact;
}

export interface ValidationEvidence {
  targetFile: string;
  finalHash?: string;
  finalArtifact?: TraceArtifact;
  requiredChecks: ValidationCheck[];
  actions: ValidationAction[];
  /** Parsing limitations are separate from missing or incomplete recordings. */
  unsupportedCommands: Array<{
    callRef: string;
    resultRef?: string;
    startedSequence: number;
    /** Absent when the command has no recorded completion. */
    sequence?: number;
    reason: string;
    /** Omitted when the command's possible verification categories are uncertain. */
    checkKinds?: ValidationCheck[];
  }>;
}

const hash = (value: unknown): string | undefined =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : undefined;

const samePath = (actual: string, expected: string) => {
  const normalized = actual.replaceAll('\\', '/').replace(/^\.\//, '');
  return (
    !normalized.split('/').includes('..') &&
    (normalized === expected || (normalized.startsWith('/') && normalized.endsWith(`/${expected}`)))
  );
};

function packageValidationCommand(
  command: string,
): { kind: ValidationCheck; verifies: boolean } | undefined {
  if (/[^A-Za-z0-9_./:=@+%\s-]/.test(command) || /[\r\n]/.test(command)) {
    return;
  }
  const parts = command.trim().split(/\s+/);
  if (!['pnpm', 'npm'].includes(parts.shift() ?? '')) {
    return;
  }
  if (parts[0] === 'run') {
    parts.shift();
  }
  const name = parts.shift();
  if (!['test', 'lint', 'build'].includes(name ?? '')) {
    return;
  }
  return {
    kind: name as ValidationCheck,
    verifies: !parts.some((part) => nonVerifyingArgument.test(part)),
  };
}

function browserAction(args: unknown): string | undefined {
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === 'string')) {
    return;
  }
  const parts = [...args] as string[];
  if (/^(?:-s|--session)=/.test(parts[0] ?? '')) {
    parts.shift();
  } else if (['-s', '--session'].includes(parts[0])) {
    parts.splice(0, 2);
  }
  return parts.length === 1 ? parts[0] : undefined;
}

function snapshotValid(
  trial: RecordedTrial,
  receipt: ObjectValue,
  config: ObjectValue,
): { valid: boolean; unknown?: string; artifact?: TraceArtifact } {
  const snapshot = object(receipt.snapshot);
  const browser = object(receipt.browser);
  const artifact = trial.trace.artifacts.find(
    (item) =>
      item.path === snapshot.path &&
      item.content === snapshot.content &&
      item.sha256 === snapshot.sha256,
  );
  if (!artifact) {
    return { valid: false, unknown: 'Snapshot content was not retained as an artifact.' };
  }
  return { ...snapshotFlowValid(trial, browser, artifact.content, config), artifact };
}

function snapshotFlowValid(
  trial: RecordedTrial,
  browser: { pageUrls?: unknown; hasError?: unknown },
  snapshotContent: string,
  config: ObjectValue,
): { valid: boolean; unknown?: string } {
  const localUrl = text(config.localUrl) || text(trial.outcome.localUrl);
  const urls = Array.isArray(browser.pageUrls) ? browser.pageUrls : [];
  if (!localUrl || !urls.length) {
    return { valid: false, unknown: 'Expected local URL or observed snapshot URL is unavailable.' };
  }
  try {
    const expected = new URL(text(config.flowPath) || '/', localUrl);
    const actual = new URL(String(urls.at(-1)));
    return {
      valid:
        ['localhost', '127.0.0.1', '[::1]'].includes(expected.hostname) &&
        actual.origin === expected.origin &&
        actual.pathname === expected.pathname &&
        !actual.username &&
        !actual.password &&
        browser.hasError === false &&
        (!text(config.expectedText) || snapshotContent.includes(text(config.expectedText))),
    };
  } catch {
    return { valid: false, unknown: 'Snapshot URL coverage is invalid.' };
  }
}

export function prepareValidationHistory(trial: RecordedTrial): PreparedItem<ValidationEvidence>[] {
  const config = object(trial.task.metadata?.validation);
  const targetFile = text(config.targetFile);
  const requested = config.requiredChecks ?? ['test'];
  if (
    !Array.isArray(requested) ||
    !requested.length ||
    requested.some((item) => !['test', 'lint', 'build', 'browser_snapshot'].includes(String(item)))
  ) {
    throw new Error('validation.requiredChecks must contain known verification kinds.');
  }
  const requiredChecks = unique(requested as string[]) as ValidationCheck[];
  const events = ordered(trial);
  const actions: ValidationAction[] = [];
  const unsupportedCommands: ValidationEvidence['unsupportedCommands'] = [];
  const gaps: string[] = [];
  const refs: string[] = [];
  for (const call of events.filter(
    (event) => event.actor === 'agent' && event.type === 'tool-call',
  )) {
    const result = resultFor(events, call);
    const receipt = object(result?.data.receipt);
    const args = object(call.data.args);
    const name = text(call.data.name);
    const beforeHash = hash(receipt.targetBeforeHash);
    const afterHash = hash(receipt.targetAfterHash);
    const directEdit = ['file-edit', 'file-write'].includes(text(receipt.kind));
    const changedTarget =
      beforeHash !== undefined && afterHash !== undefined && beforeHash !== afterHash;
    const success = typeof result?.data.success === 'boolean' ? result.data.success : 'unknown';
    const edit = (directEdit && success !== false) || changedTarget;
    let kind: ValidationCheck | undefined;
    const chained =
      name === 'bash' ? extractChainedBrowserSnapshot(trial, call, result) : undefined;
    const packageCommand = packageValidationCommand(text(args.command));
    if (receipt.kind === 'playwright-cli' && browserAction(receipt.args) === 'snapshot') {
      kind = 'browser_snapshot';
    } else if (chained) {
      kind = 'browser_snapshot';
    } else if (name === 'bash' && receipt.kind === 'bash' && packageCommand?.verifies) {
      kind = packageCommand.kind;
    }
    if (!result) {
      gaps.push(`Unfinished agent tool ${call.id} could hide a later edit or verification.`);
    }
    if (['edit', 'write'].includes(name) && !directEdit) {
      gaps.push(`Missing edit attestation for ${call.id}.`);
    }
    const unsupported =
      !kind && name === 'bash' && packageCommand?.verifies !== false
        ? classifyVerificationCommand(text(args.command))
        : undefined;
    if (unsupported) {
      const { checkKinds } = unsupported;
      unsupportedCommands.push({
        callRef: call.id,
        startedSequence: call.sequence,
        ...(result ? { resultRef: result.id, sequence: result.sequence } : {}),
        reason: 'The verification command syntax is outside the supported evidence parser.',
        ...(checkKinds?.length ? { checkKinds } : {}),
      });
      refs.push(call.id, ...(result ? [result.id] : []));
    }
    if (!kind && !edit) {
      continue;
    }
    const retained = fullOutput(trial, result);
    refs.push(call.id, ...(result ? [result.id] : []), ...(retained ? [retained.id] : []));
    const base = {
      callRef: call.id,
      name,
      args,
      receipt,
      resultText: text(result?.data.text),
      ...(retained ? { fullOutput: retained } : {}),
      ...(result ? { resultRef: result.id } : {}),
      sequence: result?.sequence ?? call.sequence,
      startedSequence: call.sequence,
      success,
      ...(success === 'unknown' ? { unknown: `Unknown tool status for ${call.id}.` } : {}),
      beforeHash,
      afterHash,
    } satisfies Omit<ValidationAction, 'kind'>;
    if (edit) {
      actions.push({ ...base, kind: 'edit' });
    }
    if (kind) {
      let browser: { valid: boolean; unknown?: string; artifact?: TraceArtifact } | undefined;
      if (kind === 'browser_snapshot') {
        if (chained?.unknown) {
          browser = { valid: false, unknown: chained.unknown };
        } else if (base.success === false || receipt.exitCode !== 0) {
          browser = { valid: false };
        } else if (!chained) {
          browser = snapshotValid(trial, receipt, config);
        } else if (chained.snapshot && chained.browser) {
          browser = snapshotFlowValid(trial, chained.browser, chained.snapshot.content, config);
        } else {
          browser = { valid: false, unknown: 'The explicit chained snapshot is unavailable.' };
        }
      }
      if (browser?.artifact) {
        refs.push(browser.artifact.id);
      }
      const unknown = [
        base.unknown,
        browser?.unknown,
        ...(result?.data.truncated === true && !retained
          ? [`Truncated verification output for ${call.id}.`]
          : []),
      ]
        .filter(Boolean)
        .join(' ');
      actions.push({
        ...base,
        kind,
        success: base.success === 'unknown' ? 'unknown' : base.success && receipt.exitCode === 0,
        ...(browser
          ? {
              browserValid: browser.valid,
              snapshotArtifact: browser.artifact,
              ...(chained?.snapshot ? { inlineSnapshot: chained.snapshot } : {}),
            }
          : {}),
        ...(unknown ? { unknown } : {}),
      });
    }
  }
  // Native recordings also retain pre-run files at the same path. Explicit final
  // references take precedence, including when legacy artifact IDs were remapped.
  const finalRefs = Array.isArray(trial.outcome.artifacts)
    ? new Set(trial.outcome.artifacts)
    : undefined;
  const final = trial.trace.artifacts.findLast(
    (item) => samePath(item.path, targetFile) && (!finalRefs || finalRefs.has(item.id)),
  );
  if (
    trial.metadata.adapter === 'pi-recording-v1' &&
    final &&
    trial.trace.artifacts.findLast((item) => samePath(item.path, targetFile))?.id !== final.id
  ) {
    gaps.push('Legacy final target reference is ambiguous after artifact ID remapping.');
  }
  if (!targetFile) {
    gaps.push('The task did not declare its validation target.');
  }
  if (!final) {
    gaps.push('The final validation target was not recorded.');
  }
  if (final) {
    refs.push(final.id);
  }
  return [
    {
      id: 'validation-history',
      data: {
        targetFile,
        finalHash: final?.sha256,
        finalArtifact: final,
        requiredChecks,
        actions,
        unsupportedCommands,
      },
      scope:
        'All observed agent edits and literal pnpm/npm test, lint, build commands, direct snapshots and supported literal browser command chains ending in snapshot; target content hashes identify the validated revision.',
      sourceRefs: unique(refs),
      coverage: coverage(trial, gaps),
      omissions: [
        'Evaluator checks and agent self-reports do not count as agent verification. Unsupported command syntax is retained as an interpretation limitation, separately from recording gaps.',
        'Verification kinds outside the task requirements are retained but do not determine this verdict. Unsupported commands with uncertain kinds can affect every required check.',
        'A successful final-revision check supersedes unsupported attempts only when they completed before that check started.',
      ],
      applicability:
        config.required === true
          ? 'applicable'
          : config.required === false
            ? 'not_applicable'
            : 'unknown',
    },
  ];
}

export const validationHistory: View<ValidationEvidence> = {
  id: 'validationHistory',
  version: 5,
  prepare: prepareValidationHistory,
};

export function checkValidationOrder(item: PreparedItem<ValidationEvidence>): CheckResult {
  if (item.applicability === 'not_applicable') {
    return { verdict: 'not_applicable', reason: 'Agent validation is not required for this task.' };
  }
  if (item.applicability === 'unknown' || !item.coverage.complete) {
    return { verdict: 'unknown', reason: 'Applicability or recording coverage is incomplete.' };
  }
  const { actions, finalHash, requiredChecks } = item.data;
  if (!hash(finalHash)) {
    return { verdict: 'unknown', reason: 'Final target revision is unavailable.' };
  }
  const lastEdit = actions
    .filter((action) => action.kind === 'edit')
    .sort((left, right) => left.sequence - right.sequence)
    .at(-1);
  const after = lastEdit?.sequence ?? 0;
  const supportingRefs: string[] = lastEdit?.resultRef ? [lastEdit.resultRef] : [];
  let uncertain = lastEdit?.success === 'unknown';
  const blockingCommands: string[] = [];
  const missing: string[] = [];
  for (const required of requiredChecks) {
    const candidates = actions.filter(
      (action) => action.kind === required && action.startedSequence > after,
    );
    const latest = candidates.sort((left, right) => left.sequence - right.sequence).at(-1);
    const matching =
      latest?.success === true &&
      !latest.unknown &&
      latest.beforeHash === finalHash &&
      latest.afterHash === finalHash &&
      (required !== 'browser_snapshot' || latest.browserValid === true)
        ? latest
        : undefined;
    const unsupported = item.data.unsupportedCommands.filter(
      (command) =>
        (!command.checkKinds?.length || command.checkKinds.includes(required)) &&
        (command.sequence === undefined ||
          (command.sequence > after &&
            (!matching || command.sequence >= matching.startedSequence))),
    );
    if (unsupported.length) {
      blockingCommands.push(...unsupported.map((command) => command.callRef));
      missing.push(required);
      continue;
    }
    if (matching) {
      supportingRefs.push(
        matching.callRef,
        ...(matching.resultRef ? [matching.resultRef] : []),
        ...(matching.inlineSnapshot ? [matching.inlineSnapshot.sourceRef] : []),
        ...(matching.snapshotArtifact ? [matching.snapshotArtifact.id] : []),
      );
      continue;
    }
    uncertain ||= candidates.some(
      (action) =>
        action.unknown || (action.success === true && (!action.beforeHash || !action.afterHash)),
    );
    missing.push(required);
  }
  if (blockingCommands.length) {
    return {
      verdict: 'unknown',
      reason: `The recording is complete, but required verification command syntax could not be interpreted at ${unique(blockingCommands).join(', ')}.`,
      supportingRefs: unique(supportingRefs),
    };
  }
  if (!missing.length) {
    return {
      verdict: 'pass',
      reason:
        'Every required agent verification succeeded after the final observed edit and matches the final target revision.',
      supportingRefs: unique([
        ...supportingRefs,
        ...(item.data.finalArtifact ? [item.data.finalArtifact.id] : []),
      ]),
    };
  }
  return {
    verdict: uncertain ? 'unknown' : 'fail',
    reason: uncertain
      ? `Verification could not be established from incomplete attestations: ${missing.join(', ')}.`
      : `The complete recording lacks successful validation of the final revision after its last edit: ${missing.join(', ')}.`,
    supportingRefs: unique(supportingRefs),
  };
}

export const finalValidation: CodeGrader<ValidationEvidence> = {
  kind: 'code',
  id: 'validation-after-final-edit',
  version: 4,
  view: validationHistory,
  check: checkValidationOrder,
};
