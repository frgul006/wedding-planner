import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { RecordedTrial } from 'agent-evals';
import { normalizeToolReceipt } from 'agent-evals/pi';
import {
  checkValidationOrder,
  prepareValidationHistory,
} from '../../views/validation-history/index.ts';
import { edit, finalHash, tool, trial, verify } from './validation-fixtures.ts';

const grade = (recording: RecordedTrial) =>
  checkValidationOrder(prepareValidationHistory(recording)[0]);

function browserChainRecording(
  options: {
    exitCode?: number;
    url?: string;
    snapshot?: string;
    command?: string;
  } = {},
) {
  const command =
    options.command ??
    'playwright-cli -s=eval fill e26 "some literal value" && playwright-cli -s=eval click e29 && sleep 2 && playwright-cli -s=eval snapshot';
  const snapshot = options.snapshot ?? '- alert: Invalid email or password.\n- button "Sign in"';
  const output = `### Page\n- Page URL: ${options.url ?? 'http://127.0.0.1:3456/admin/login'}\n- Page Title: Login\n### Snapshot\n\`\`\`yaml\n${snapshot}\n\`\`\`\n`;
  const sha256 = createHash('sha256').update(output).digest('hex');
  const callId = 'tool-3';
  const outputCapture = {
    path: `native-output:${callId}`,
    sha256,
    kind: 'command-output',
    encoding: 'utf8',
  };
  const nativeReceipt = {
    kind: 'bash',
    exitCode: options.exitCode ?? 0,
    targetBeforeHash: finalHash,
    targetAfterHash: finalHash,
    outputCapture,
  };
  const nativeResult = {
    content: [{ type: 'text', text: output }],
    details: { evaluation: nativeReceipt },
  };
  const [call, result] = tool(
    3,
    'bash',
    { command },
    { ...normalizeToolReceipt(nativeReceipt, output, callId) },
    nativeReceipt.exitCode === 0,
    output,
  );
  call.source = {
    kind: 'pi',
    payload: {
      type: 'tool_execution_start',
      toolName: 'bash',
      toolCallId: callId,
      args: { command },
    },
  };
  result.source = {
    kind: 'pi',
    payload: {
      type: 'tool_execution_end',
      toolName: 'bash',
      toolCallId: callId,
      isError: nativeReceipt.exitCode !== 0,
      result: nativeResult,
    },
  };
  result.data.outputCapture = outputCapture;
  result.data.fullOutputRef = 'captured-browser-output';
  const recording = trial([...edit(1), call, result]);
  recording.trace.artifacts.push({
    id: 'captured-browser-output',
    path: outputCapture.path,
    content: output,
    sha256,
  });
  recording.task.metadata!.validation = {
    required: true,
    targetFile: 'src/login.ts',
    requiredChecks: ['browser_snapshot'],
    flowPath: '/admin/login',
    expectedText: 'Invalid email or password.',
  };
  return recording;
}

test('a recorded literal browser chain proves validation and cites its exact output and final revision', () => {
  const recording = browserChainRecording();
  const prepared = prepareValidationHistory(recording)[0];
  assert.equal(prepared.coverage.complete, true);
  assert.equal(prepared.data.unsupportedCommands.length, 0);
  const result = checkValidationOrder(prepared);
  assert.equal(result.verdict, 'pass', result.reason);
  assert.ok(result.supportingRefs!.includes('captured-browser-output'));
  assert.ok(result.supportingRefs!.includes('final-source'));
  assert.equal(prepared.data.actions.at(-1)!.inlineSnapshot!.sourceRef, 'captured-browser-output');
  assert.equal(
    recording.trace.artifacts.length,
    2,
    'preparing does not invent saved snapshot artifacts',
  );
});

test('chained verification preserves failed results, flow mismatches, final-edit ordering and gaps', () => {
  for (const options of [
    { exitCode: 1 },
    { url: 'http://127.0.0.1:3456/unrelated' },
    { url: 'https://example.com/admin/login' },
    { snapshot: '- button "Sign in"' },
  ]) {
    assert.equal(grade(browserChainRecording(options)).verdict, 'fail');
  }
  const laterEdit = browserChainRecording();
  laterEdit.trace.events.push(...edit(5, finalHash, finalHash));
  assert.equal(grade(laterEdit).verdict, 'fail');
  const evaluatorOnly = browserChainRecording();
  for (const e of evaluatorOnly.trace.events.slice(2)) {
    e.actor = 'evaluator';
  }
  assert.equal(grade(evaluatorOnly).verdict, 'fail');
  const missingCapture = browserChainRecording();
  missingCapture.trace.artifacts.pop();
  assert.equal(grade(missingCapture).verdict, 'unknown');
  const unsupported = browserChainRecording({
    command: 'playwright-cli snapshot && echo fake',
  });
  assert.equal(grade(unsupported).verdict, 'unknown');
});

test('a help-like value cannot hide a later unsupported or failed browser command', () => {
  for (const command of [
    'playwright-cli fill e1 --help && playwright-cli snapshot --unsupported',
    'sleep 1 && playwright-cli snapshot --unsupported',
    'sleep 1 && playwright-cli fill e1 --help && playwright-cli snapshot',
    'cd /tmp && playwright-cli snapshot --unsupported',
    'env playwright-cli snapshot --unsupported',
    'cd /tmp && pnpm exec playwright-cli snapshot',
    'env npx playwright-cli snapshot',
    'env bash -c "playwright-cli snapshot"',
    'echo "$(playwright-cli snapshot)"',
    'pnpm test && playwright-cli snapshot --unsupported',
  ]) {
    const recording = browserChainRecording();
    recording.trace.events.push(...verify(5, command, finalHash, 1));
    const prepared = prepareValidationHistory(recording)[0];
    assert.equal(prepared.coverage.complete, true);
    assert.deepEqual(
      prepared.data.unsupportedCommands.map((entry) => entry.callRef),
      ['call-5'],
    );
    assert.equal(checkValidationOrder(prepared).verdict, 'unknown');
  }
  assert.equal(
    grade(
      browserChainRecording({
        command: 'playwright-cli fill e1 --help && playwright-cli snapshot',
      }),
    ).verdict,
    'unknown',
    'the CLI can interpret an option-like fill value as a flag',
  );
});

test('quoted documentation after successful validation does not imply another browser attempt', () => {
  for (const command of [
    'echo "playwright-cli snapshot"',
    'echo "cd /tmp && playwright-cli snapshot"',
    "printf '%s' 'playwright-cli snapshot --unsupported'",
  ]) {
    const recording = browserChainRecording();
    recording.trace.events.push(...verify(5, command));
    assert.equal(grade(recording).verdict, 'pass');
  }
});

test('unsupported checks remain recorded but only block requirements they could affect', () => {
  const recording = browserChainRecording();
  recording.trace.events.push(
    ...verify(
      5,
      'PLAYWRIGHT_BASE_URL=http://127.0.0.1:3456 pnpm exec playwright test e2e/login.spec.ts',
    ),
  );
  const prepared = prepareValidationHistory(recording)[0];
  assert.deepEqual(prepared.data.unsupportedCommands[0].checkKinds, ['test']);
  assert.ok(prepared.sourceRefs.includes('call-5'));
  assert.equal(checkValidationOrder(prepared).verdict, 'pass');
  recording.task.metadata!.validation = {
    ...(recording.task.metadata!.validation as Record<string, unknown>),
    requiredChecks: ['browser_snapshot', 'test'],
  };
  assert.equal(grade(recording).verdict, 'unknown');
  const chained = browserChainRecording();
  chained.trace.events.push(...verify(5, 'pnpm test --help && pnpm test --unsupported'));
  chained.task.metadata!.validation = recording.task.metadata!.validation;
  assert.equal(grade(chained).verdict, 'unknown', 'help in a chain cannot hide a required test');
});

test('a later recognized chain with missing or malformed receipts prevents an earlier pass', () => {
  for (const receipt of [undefined, { kind: 'unknown' }, { kind: 'file-read' }]) {
    const recording = browserChainRecording();
    const later = verify(5, 'sleep 1 && playwright-cli snapshot');
    later[1].data.receipt = receipt;
    recording.trace.events.push(...later);
    const prepared = prepareValidationHistory(recording)[0];
    assert.equal(prepared.data.actions.at(-1)!.callRef, 'call-5');
    assert.equal(prepared.data.actions.at(-1)!.kind, 'browser_snapshot');
    assert.ok(prepared.data.actions.at(-1)!.unknown);
    assert.equal(checkValidationOrder(prepared).verdict, 'unknown');
  }
});

test('browser validation needs the exact saved snapshot for the changed local flow and final revision', () => {
  const snapshot = {
    path: '.playwright-cli/page.yaml',
    sha256: '3'.repeat(64),
    content: '- alert: Invalid email or password.',
  };
  const receipt = {
    kind: 'playwright-cli',
    args: ['-s=eval', 'snapshot'],
    exitCode: 0,
    targetBeforeHash: finalHash,
    targetAfterHash: finalHash,
    snapshot,
    browser: {
      pageUrls: ['http://127.0.0.1:3456/admin/login'],
      hasError: false,
    },
  };
  const recording = trial([
    ...edit(1),
    ...tool(3, 'bash', { command: 'playwright-cli -s=eval snapshot' }, receipt),
  ]);
  recording.task.metadata!.validation = {
    required: true,
    targetFile: 'src/login.ts',
    requiredChecks: ['browser_snapshot'],
    flowPath: '/admin/login',
    expectedText: 'Invalid email or password.',
  };
  recording.trace.artifacts.push({ id: 'snapshot-1', ...snapshot });
  assert.equal(grade(recording).verdict, 'pass');
  assert.ok(prepareValidationHistory(recording)[0].sourceRefs.includes('snapshot-1'));
  recording.trace.events.at(-1)!.data.success = 'unknown';
  const unknownStatus = prepareValidationHistory(recording)[0];
  assert.equal(checkValidationOrder(unknownStatus).verdict, 'unknown');
  assert.equal(unknownStatus.data.actions.at(-1)!.success, 'unknown');
  assert.equal(unknownStatus.data.actions.at(-1)!.snapshotArtifact!.id, 'snapshot-1');
  recording.trace.events.at(-1)!.data.success = true;
  receipt.browser.pageUrls = ['http://127.0.0.1:3456/unrelated'];
  assert.equal(grade(recording).verdict, 'fail');
  receipt.browser.pageUrls = ['http://127.0.0.1:3456/admin/login'];
  recording.trace.artifacts.pop();
  assert.equal(grade(recording).verdict, 'unknown');
});

test('an observed failed snapshot is failed behavior, not a missing successful artifact', () => {
  const recording = trial([
    ...edit(1),
    ...tool(
      3,
      'bash',
      { command: 'playwright-cli snapshot' },
      {
        kind: 'playwright-cli',
        args: ['snapshot'],
        exitCode: 1,
        targetBeforeHash: finalHash,
        targetAfterHash: finalHash,
      },
      false,
      'No browser session exists',
    ),
  ]);
  recording.task.metadata!.validation = {
    required: true,
    targetFile: 'src/login.ts',
    requiredChecks: ['browser_snapshot'],
  };
  assert.equal(grade(recording).verdict, 'fail');
});

test('unknown native status for a browser chain remains uncertainty with its retained output', () => {
  const recording = browserChainRecording();
  const result = recording.trace.events.at(-1)!;
  result.data.success = 'unknown';
  delete (result.source!.payload as Record<string, unknown>).isError;
  const prepared = prepareValidationHistory(recording)[0];
  assert.equal(prepared.data.actions.at(-1)!.success, 'unknown');
  assert.ok(prepared.sourceRefs.includes('captured-browser-output'));
  assert.equal(checkValidationOrder(prepared).verdict, 'unknown');
});
