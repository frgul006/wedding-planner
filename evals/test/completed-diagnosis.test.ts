import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { EvidenceEvent, TrialEvidence } from 'agent-evals/pi';
import { recordedTrialFromEvidence } from 'agent-evals/pi';
import { completedDiagnosis, prepareCompletedDiagnosis } from '../views/diagnosis.ts';

function recording(
  testOutput = 'Expected pending, received idle. Test failed before retry assertion.',
) {
  const eventData: Array<{
    actor?: EvidenceEvent['actor'];
    kind?: EvidenceEvent['kind'];
    data: Record<string, unknown>;
  }> = [
    { actor: 'evaluator', kind: 'lifecycle', data: { type: 'pi_started' } },
    {
      actor: 'evaluator',
      data: { type: 'response', command: 'prompt', success: true },
    },
    { data: { type: 'agent_start' } },
    {
      data: {
        type: 'message_end',
        message: { role: 'user', content: 'Investigate the retry.' },
      },
    },
    {
      data: {
        type: 'tool_execution_start',
        toolCallId: 'before',
        toolName: 'read',
        args: { path: 'form.tsx' },
      },
    },
    {
      data: {
        type: 'tool_execution_end',
        toolCallId: 'before',
        isError: false,
        result: { content: [{ type: 'text', text: 'Earlier exploration' }] },
      },
    },
    {
      data: {
        type: 'message_end',
        message: {
          role: 'assistant',
          content:
            'Hypothesis: if the error disables submission, then changing credentials will not enable retry.',
        },
      },
    },
    {
      data: {
        type: 'tool_execution_start',
        toolCallId: 'write',
        toolName: 'write',
        args: { path: 'retry.spec.ts', content: 'assert(retry.enabled)' },
      },
    },
    {
      data: {
        type: 'tool_execution_end',
        toolCallId: 'write',
        isError: false,
        result: { content: [{ type: 'text', text: 'Wrote test' }] },
      },
    },
    {
      data: {
        type: 'tool_execution_start',
        toolCallId: 'test',
        toolName: 'bash',
        args: {
          command:
            'PLAYWRIGHT_BASE_URL=http://127.0.0.1:4321 pnpm exec playwright test retry.spec.ts',
        },
      },
    },
    {
      data: {
        type: 'tool_execution_end',
        toolCallId: 'test',
        isError: true,
        result: {
          content: [
            {
              type: 'text',
              text: testOutput,
            },
          ],
        },
      },
    },
    { data: { type: 'turn_end' } },
    {
      data: {
        type: 'message_end',
        message: {
          role: 'assistant',
          content: 'Later contradiction: this was a different cause.',
        },
      },
    },
    {
      actor: 'evaluator',
      kind: 'lifecycle',
      data: { type: 'stop_requested', reason: 'budget_exceeded' },
    },
    {
      data: {
        type: 'tool_execution_start',
        toolCallId: 'last-edit',
        toolName: 'edit',
        args: { path: 'form.tsx' },
      },
    },
  ];
  const events: EvidenceEvent[] = eventData.map((value, index) => ({
    id: `e${index + 1}`,
    sequence: index + 1,
    timestamp: '2026-09-27T12:00:00Z',
    actor: value.actor ?? 'agent',
    kind: value.kind ?? 'pi',
    data: value.data,
  }));
  const evidence: TrialEvidence = {
    task: {
      id: 'retry',
      version: '1',
      prompt: 'Investigate the retry.',
      targetFile: 'form.tsx',
      expectedText: 'Retry',
      flowPath: '/',
    },
    variant: 'enabled',
    localUrl: 'http://127.0.0.1:4321',
    events,
    artifacts: [],
    agent: {
      status: 'budget_exceeded',
      startedAt: '',
      endedAt: '',
      exitCode: 1,
      signal: null,
      model: { id: 'offline-model' },
      thinkingLevel: 'medium',
      usage: {
        inputTokens: 10,
        outputTokens: 2,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        estimatedCostUsd: null,
        costSource: 'subscription',
      },
    },
  };
  const context = {
    id: 'instructions',
    path: 'AGENTS.md',
    content: 'Investigate before editing.',
    kind: 'effective-instruction',
    sha256: createHash('sha256').update('Investigate before editing.').digest('hex'),
  };
  const trial = recordedTrialFromEvidence('trial-prefix', evidence, {
    recordedContexts: [context],
    contextCaptureGaps: [],
  });
  trial.task.metadata = { diagnosis: 'required' };
  return trial;
}

test('completed-attempt view preserves first failed probe and test source while the whole trial stays incomplete', () => {
  const trial = recording();
  const original = JSON.stringify(trial);
  const [item] = prepareCompletedDiagnosis(trial);
  assert.equal(completedDiagnosis.version, 1);
  assert.equal(item.coverage.complete, true, item.coverage.gaps.join('\n'));
  assert.equal(item.data.probes.length, 2);
  assert.equal(item.data.probes[0].args.content, 'assert(retry.enabled)');
  assert.equal(item.data.probes[1].result?.success, false);
  assert.equal(item.data.probes[1].result?.textLines, undefined);
  assert.match(item.data.probes[1].result!.text, /before retry assertion/);
  assert.equal(item.data.conversation.length, 1);
  assert.equal(item.data.conversation[0].role, 'user');
  assert.equal(JSON.stringify(item.data).includes('Later contradiction'), false);
  assert.match(item.omissions.join('\n'), /including any later contradictions/);
  assert.match(item.omissions.join('\n'), /e13, e15/);
  assert.match(item.omissions.join('\n'), /parent trial remains budget_exceeded, complete=false/);
  assert.match(item.scope, /not a judgment of the whole trial/);
  assert.equal(JSON.stringify(trial), original);
});

test('missing or changed prefix observations cannot be waived by a later interruption', () => {
  const mutations = [
    (trial: ReturnType<typeof recording>) => {
      trial.trace.events.splice(5, 1);
    },
    (trial: ReturnType<typeof recording>) => {
      trial.trace.events[5].actor = 'evaluator';
    },
    (trial: ReturnType<typeof recording>) => {
      trial.trace.events[10].data.text = 'Tests passed';
    },
    (trial: ReturnType<typeof recording>) => {
      delete trial.trace.events[10].source;
    },
    (trial: ReturnType<typeof recording>) => {
      trial.trace.contexts[0].content = 'Changed history';
    },
    (trial: ReturnType<typeof recording>) => {
      trial.trace.gaps.push('Unscoped missing output.');
    },
    (trial: ReturnType<typeof recording>) => {
      trial.trace.events[13].data.reason = 'timeout';
    },
    (trial: ReturnType<typeof recording>) => {
      trial.metadata.adapter = 'unrecognized-recorder';
    },
    (trial: ReturnType<typeof recording>) => {
      for (const index of [7, 8]) {
        trial.trace.events[index].type = 'lifecycle';
        trial.trace.events[index].data = trial.trace.events[index].source!.payload as Record<
          string,
          unknown
        >;
      }
    },
    (trial: ReturnType<typeof recording>) => {
      trial.trace.events[3].type = 'lifecycle';
      trial.trace.events[3].data = trial.trace.events[3].source!.payload as Record<string, unknown>;
    },
  ];
  for (const mutate of mutations) {
    const trial = recording();
    mutate(trial);
    const [item] = prepareCompletedDiagnosis(trial);
    assert.equal(item.coverage.complete, false);
    assert.ok(item.coverage.gaps.length);
    assert.equal(item.applicability, 'applicable');
  }
});

test('a pending parallel call at the test boundary prevents scoped completeness', () => {
  const trial = recording();
  trial.trace.events[8].type = 'lifecycle';
  trial.trace.events[8].data = { type: 'message_start' };
  trial.trace.events[8].source = {
    kind: 'pi',
    payload: trial.trace.events[8].data,
  };
  const [item] = prepareCompletedDiagnosis(trial);
  assert.equal(item.coverage.complete, false);
  assert.match(item.coverage.gaps.join(' '), /Prefix call agent:write has no completed result/);
});

test('no completed testing boundary emits an unknown-coverage item rather than asserting omitted behavior', () => {
  const trial = recording();
  trial.trace.events[9].data.args = { command: 'pnpm test --help' };
  const [item] = prepareCompletedDiagnosis(trial);
  assert.equal(item.coverage.complete, false);
  assert.deepEqual(item.data.probes, []);
  assert.match(item.coverage.gaps.join(' '), /not all captured/);
});

test('line dictionaries preserve repeated failed output byte-for-byte including Unicode and empty lines', () => {
  const block = 'Expected pending, received idle.\r\n─ Failed before retry assertion ─\n\r\n';
  const output = block.repeat(12) + 'Final retry failed.\n';
  const trial = recording(output);
  const original = JSON.stringify(trial);
  const [item] = prepareCompletedDiagnosis(trial);
  assert.equal(item.coverage.complete, true, item.coverage.gaps.join('\n'));
  const result = item.data.probes[1].result!;
  assert.equal(result.success, false);
  assert.equal(result.textLines?.format, 'line-dictionary-v1');
  const encoded = result.textLines!;
  const reconstructed = encoded.order.map((index) => encoded.dictionary[index]).join('\n');
  assert.equal(reconstructed, output);
  assert.equal(encoded.sha256, createHash('sha256').update(output).digest('hex'));
  assert.equal(Buffer.byteLength(reconstructed), Buffer.byteLength(output));
  assert.match(result.text, /join textLines.dictionary entries/);
  assert.match(item.omissions.join(' '), /No selected output is dropped/);
  assert.equal(JSON.stringify(trial), original);
});
