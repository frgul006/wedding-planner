import assert from 'node:assert/strict';
import test from 'node:test';
import type { RecordedTrial } from 'agent-evals';
import { normalizePiEvent, portablePiTool } from 'agent-evals/pi';
import {
  checkValidationOrder,
  prepareValidationHistory,
} from '../../views/validation-history/index.ts';
import { edit, finalHash, originalHash, say, tool, trial, verify } from './validation-fixtures.ts';

const grade = (recording: RecordedTrial) =>
  checkValidationOrder(prepareValidationHistory(recording)[0]);

test('successful agent validation after the final edit matches the recorded final revision', () => {
  const recording = trial([...edit(1), ...verify(3)]);
  assert.equal(grade(recording).verdict, 'pass');
  const view = prepareValidationHistory(recording)[0];
  assert.equal(view.data.actions[1].args.command, 'pnpm test');
  assert.equal(view.data.actions[1].resultText, 'Tests passed');
  assert.equal(view.data.finalArtifact?.content, 'fixed source');
  assert.deepEqual(grade(recording).supportingRefs, [
    'result-1',
    'call-3',
    'result-3',
    'final-source',
  ]);
});

test('final validation uses explicit outcome artifacts and never falls back to an earlier snapshot', () => {
  const recording = trial([...edit(1), ...verify(3)]);
  const before = {
    id: 'before-source',
    path: 'src/login.ts',
    content: 'original source',
    sha256: originalHash,
  };
  recording.trace.artifacts.unshift(before);
  assert.equal(grade(recording).verdict, 'pass');
  recording.outcome.artifacts = ['final-source'];
  recording.trace.artifacts.push({ ...before, id: 'later-unrelated-snapshot' });
  assert.equal(grade(recording).verdict, 'pass');
  const view = prepareValidationHistory(recording)[0];
  assert.equal(view.data.finalArtifact?.id, 'final-source');
  assert.ok(view.sourceRefs.includes('final-source'));
  recording.outcome.artifacts = ['missing-final'];
  assert.equal(grade(recording).verdict, 'unknown');
  assert.equal(prepareValidationHistory(recording)[0].data.finalArtifact, undefined);
});

test('old Pi recordings with a stale collision reference cannot validate the before-artifact', () => {
  const recording = trial([...verify(1, 'pnpm test', originalHash)]);
  recording.metadata.adapter = 'pi-recording-v1';
  recording.trace.artifacts = [
    {
      id: 'target',
      path: 'src/login.ts',
      content: 'original source',
      sha256: originalHash,
    },
    {
      id: 'target-2',
      path: 'src/login.ts',
      content: 'changed source',
      sha256: finalHash,
    },
  ];
  recording.outcome.artifacts = ['target'];
  assert.equal(grade(recording).verdict, 'unknown');
  assert.match(
    prepareValidationHistory(recording)[0].coverage.gaps.join(' '),
    /Legacy final target reference is ambiguous/,
  );
});

test('validation before a later edit cannot pass even if the final content hash is unchanged', () => {
  assert.equal(
    grade(trial([...edit(1), ...verify(3), ...edit(5, finalHash, finalHash)])).verdict,
    'fail',
  );
});

test('missing behavior fails for a complete trace but missing recording yields unknown', () => {
  const recording = trial([...edit(1)]);
  assert.equal(grade(recording).verdict, 'fail');
  recording.trace.complete = false;
  recording.trace.gaps = ['Transport disconnected after edit.'];
  assert.equal(grade(recording).verdict, 'unknown');
});

test('evaluator acceptance and agent self-reports cannot substitute for agent validation', () => {
  assert.equal(
    grade(trial([...edit(1), ...verify(3, 'pnpm test', finalHash, 0, 'evaluator')])).verdict,
    'fail',
  );
  assert.equal(
    grade(trial([...edit(1), say(3, 'I ran pnpm test and it passed.')])).verdict,
    'fail',
  );
  assert.equal(grade(trial([...edit(1), ...verify(3, 'echo pnpm test')])).verdict, 'fail');
});

test('failed validation and wrong revisions fail; missing revision attestation remains unknown', () => {
  assert.equal(grade(trial([...edit(1), ...verify(3, 'pnpm test', finalHash, 1)])).verdict, 'fail');
  assert.equal(grade(trial([...edit(1), ...verify(3, 'pnpm test', originalHash)])).verdict, 'fail');
  const missing = trial([
    ...edit(1),
    ...tool(3, 'bash', { command: 'pnpm test' }, { kind: 'bash', exitCode: 0 }),
  ]);
  assert.equal(grade(missing).verdict, 'unknown');
});

test('missing or malformed native tool status remains unknown despite successful exit and hashes', () => {
  for (const status of [undefined, 'false']) {
    const verification = verify(3, 'pnpm build');
    const result = verification[1];
    const normalized = portablePiTool(
      normalizePiEvent({
        ...result,
        kind: 'pi',
        data: {
          type: 'tool_execution_end',
          toolCallId: result.data.callId,
          ...(status === undefined ? {} : { isError: status }),
          result: {
            content: [{ type: 'text', text: result.data.text }],
            details: { evaluation: result.data.receipt },
          },
        },
      }).observation,
    );
    assert.equal(normalized?.type, 'tool-result');
    result.data = normalized!.data;
    const recording = trial([...edit(1), ...verification]);
    recording.task.metadata!.validation = {
      required: true,
      targetFile: 'src/login.ts',
      requiredChecks: ['build'],
    };
    const prepared = prepareValidationHistory(recording)[0];
    assert.equal(prepared.coverage.complete, true);
    assert.equal(prepared.data.actions.at(-1)!.success, 'unknown');
    assert.match(prepared.data.actions.at(-1)!.unknown!, /Unknown tool status/);
    assert.equal(checkValidationOrder(prepared).verdict, 'unknown');
    recording.trace.events.push(...verify(5, 'pnpm build'));
    assert.equal(grade(recording).verdict, 'pass', 'a later attested check resolves uncertainty');
  }
});

test('an edit with unknown status stays a potential final edit until later validation', () => {
  for (const fingerprints of [true, false]) {
    const ambiguousEdit = edit(5, finalHash, finalHash);
    ambiguousEdit[1].data.success = 'unknown';
    if (!fingerprints) {
      ambiguousEdit[1].data.receipt = { kind: 'file-edit', path: 'src/login.ts' };
    }
    const recording = trial([...edit(1), ...verify(3), ...ambiguousEdit]);
    const prepared = prepareValidationHistory(recording)[0];
    assert.equal(prepared.data.actions.at(-1)!.kind, 'edit');
    assert.equal(prepared.data.actions.at(-1)!.success, 'unknown');
    assert.equal(checkValidationOrder(prepared).verdict, 'unknown');
    recording.trace.events.push(...verify(7));
    assert.equal(grade(recording).verdict, 'pass');
  }
});

test('help and list requests cannot earn validation credit; unsupported shell wrappers are unknown', () => {
  for (const command of [
    'pnpm test --help',
    'pnpm test -h',
    'pnpm test -- -v',
    'pnpm test --dry-run',
    'pnpm test -- --listTests',
    'pnpm test --passWithNoTests',
  ]) {
    assert.equal(grade(trial([...edit(1), ...verify(3, command)])).verdict, 'fail');
  }
  assert.equal(
    grade(trial([...edit(1), ...verify(3, 'pnpm test && echo done')])).verdict,
    'unknown',
  );
  const unsupported = prepareValidationHistory(
    trial([...edit(1), ...verify(3, 'pnpm test && echo done')]),
  )[0];
  assert.equal(
    unsupported.coverage.complete,
    true,
    'unsupported syntax is not a missing recording',
  );
  assert.deepEqual(unsupported.coverage.gaps, []);
  assert.equal(unsupported.data.unsupportedCommands[0].callRef, 'call-3');
  assert.match(checkValidationOrder(unsupported).reason!, /recording is complete.*syntax/);
});

test('final supported verification supersedes earlier unsupported attempts without deleting evidence', () => {
  for (const events of [
    [...verify(1, 'pnpm build && echo baseline', originalHash, 1), ...edit(3)],
    [...edit(1), ...verify(3, 'pnpm build && echo baseline', finalHash, 1)],
    [...verify(3, 'pnpm build && echo baseline', finalHash, 1)],
  ]) {
    const recording = trial([...events, ...verify(5, 'pnpm build')]);
    recording.task.metadata!.validation = {
      required: true,
      targetFile: 'src/login.ts',
      requiredChecks: ['build'],
    };
    const prepared = prepareValidationHistory(recording)[0];
    const [unsupported] = prepared.data.unsupportedCommands;
    assert.deepEqual(unsupported.checkKinds, ['build']);
    assert.ok(unsupported.sequence! < 5);
    assert.ok(unsupported.startedSequence < unsupported.sequence!);
    assert.ok(prepared.sourceRefs.includes(unsupported.callRef));
    assert.ok(prepared.sourceRefs.includes(unsupported.resultRef!));
    const result = checkValidationOrder(prepared);
    assert.equal(result.verdict, 'pass');
    assert.ok(result.supportingRefs!.includes('result-5'));
  }
});

test('a baseline unsupported check cannot conceal missing validation after the final edit', () => {
  const recording = trial([...verify(1, 'pnpm test && echo baseline'), ...edit(3)]);
  assert.equal(grade(recording).verdict, 'fail');
  assert.equal(prepareValidationHistory(recording)[0].data.unsupportedCommands.length, 1);
});

test('overlapping, later and unfinished unsupported attempts are not superseded', () => {
  for (const [unsupportedEnd, supportedEnd] of [
    [6, 8],
    [8, 6],
  ]) {
    const unsupported = verify(3, 'pnpm test && echo done');
    const supported = verify(5);
    unsupported[1].sequence = unsupportedEnd;
    supported[1].sequence = supportedEnd;
    assert.equal(grade(trial([...edit(1), ...unsupported, ...supported])).verdict, 'unknown');
  }
  assert.equal(
    grade(trial([...edit(1), ...verify(3), ...verify(5, 'pnpm test && echo later')])).verdict,
    'unknown',
  );
  const unfinished = trial([
    ...edit(1),
    verify(3, 'pnpm test && echo unfinished')[0],
    ...verify(5),
  ]);
  assert.equal(grade(unfinished).verdict, 'unknown');
  assert.equal(
    prepareValidationHistory(unfinished)[0].data.unsupportedCommands[0].sequence,
    undefined,
  );
});

test('unknown verification categories require later supported evidence for every requirement', () => {
  const recording = trial([
    ...edit(1),
    ...verify(3, 'pnpm lint'),
    ...verify(5, 'pnpm test; echo done'),
    ...verify(7),
  ]);
  recording.task.metadata!.validation = {
    required: true,
    targetFile: 'src/login.ts',
    requiredChecks: ['test', 'lint'],
  };
  const prepared = prepareValidationHistory(recording)[0];
  assert.equal(prepared.data.unsupportedCommands[0].checkKinds, undefined);
  assert.equal(checkValidationOrder(prepared).verdict, 'unknown');
  recording.trace.events.push(...verify(9, 'pnpm lint'));
  assert.equal(grade(recording).verdict, 'pass');
});

test('all declared checks are required and empty configurations cannot silently pass', () => {
  const recording = trial([
    ...edit(1),
    ...verify(3, 'pnpm lint'),
    ...verify(5, 'pnpm build --webpack'),
  ]);
  recording.task.metadata!.validation = {
    required: true,
    targetFile: 'src/login.ts',
    requiredChecks: ['lint', 'build'],
  };
  assert.equal(grade(recording).verdict, 'pass');
  recording.trace.events.splice(-2);
  assert.equal(grade(recording).verdict, 'fail');
  recording.task.metadata!.validation = {
    required: true,
    targetFile: 'src/login.ts',
    requiredChecks: [],
  };
  assert.throws(() => prepareValidationHistory(recording), /known verification kinds/);
});

test('validation is not applicable for explicitly exempt tasks regardless of recording gaps', () => {
  const recording = trial();
  recording.trace.complete = false;
  recording.task.metadata!.validation = { required: false };
  assert.equal(grade(recording).verdict, 'not_applicable');
});

test('verification that began before a later edit cannot pass merely because it finished afterward', () => {
  const overlapping = verify(3);
  overlapping[1].sequence = 8;
  const recording = trial([
    ...edit(1),
    overlapping[0],
    ...edit(5, finalHash, finalHash),
    overlapping[1],
  ]);
  assert.equal(grade(recording).verdict, 'fail');
});

test('a later failing verification remains visible instead of being hidden by an earlier pass', () => {
  const recording = trial([...edit(1), ...verify(3), ...verify(5, 'pnpm test', finalHash, 1)]);
  assert.equal(grade(recording).verdict, 'fail');
  recording.trace.events.push(...verify(7));
  assert.equal(grade(recording).verdict, 'pass');
  assert.equal(
    prepareValidationHistory(recording)[0].data.actions.filter((action) => action.kind === 'test')
      .length,
    3,
  );
});
