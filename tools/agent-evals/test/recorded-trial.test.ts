import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { EvidenceEvent, TrialEvidence } from '../src/domain/types.ts';
import { recordedTrialFromEvidence } from '../src/adapters/recorded-trial.ts';
import { checkValidationOrder, prepareValidationHistory } from '../src/examples/diagnosis.ts';

const hash = (content: string) => createHash('sha256').update(content).digest('hex');
const context = {
  id: 'instruction',
  path: '/historical/AGENTS.md',
  kind: 'effective-instruction',
  content: 'Run tests.',
  sha256: hash('Run tests.'),
};
const environment = { recordedContexts: [context], contextCaptureGaps: [] };
function recording(
  data: Record<string, unknown>[],
  status: TrialEvidence['agent']['status'] = 'completed',
): TrialEvidence {
  const events: EvidenceEvent[] = data.map((value, index) => ({
    id: `e${index + 1}`,
    sequence: index + 1,
    timestamp: '2026-09-27T12:00:00Z',
    actor: 'agent',
    kind: 'pi',
    data: value,
  }));
  return {
    task: {
      id: 'test',
      version: '1',
      prompt: 'Repair the form.',
      targetFile: 'form.tsx',
      expectedText: 'Saved',
      flowPath: '/form',
    },
    variant: 'enabled',
    localUrl: 'http://127.0.0.1:4321',
    artifacts: [],
    events,
    agent: {
      status,
      startedAt: '',
      endedAt: '',
      exitCode: 0,
      signal: null,
      model: { id: 'gpt-6-luna' },
      thinkingLevel: 'xhigh',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        estimatedCostUsd: null,
        costSource: 'subscription',
      },
    },
  };
}
const start = {
  type: 'tool_execution_start',
  toolCallId: 'c1',
  toolName: 'bash',
  args: { command: 'pnpm test' },
};
const end = {
  type: 'tool_execution_end',
  toolCallId: 'c1',
  isError: false,
  result: {
    content: [{ type: 'text', text: 'Tests passed' }],
    details: { evaluation: { kind: 'bash', exitCode: 0 } },
  },
};
const settled = { type: 'agent_settled' };

test('historical duplicate agent events do not change the authoritative saved trace', () => {
  const evidence = recording([start, end, settled]);
  const historical = {
    ...evidence,
    agent: { ...evidence.agent, events: evidence.events },
  };
  const serialized = JSON.stringify(historical);
  assert.deepEqual(
    recordedTrialFromEvidence('same-trial', historical, environment),
    recordedTrialFromEvidence('same-trial', evidence, environment),
  );
  assert.equal(JSON.stringify(historical), serialized);
});

test('portable trace preserves native sources, attribution and observable text without hidden reasoning', () => {
  const evidence = recording([
    { type: 'message_end', message: { role: 'user', content: 'Repair the form.' } },
    {
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'PRIVATE_REASONING' },
          { type: 'text', text: 'I predict the value is reset on reload.' },
        ],
      },
    },
    start,
    end,
    settled,
  ]);
  const original = JSON.stringify(evidence);
  const trial = recordedTrialFromEvidence('trial-1', evidence, environment);
  assert.equal(trial.trace.complete, true);
  assert.deepEqual(
    trial.trace.events.map((event) => event.type),
    ['message', 'message', 'tool-call', 'tool-result', 'lifecycle'],
  );
  assert.deepEqual(trial.trace.events[2].data, {
    callId: 'c1',
    name: 'bash',
    args: { command: 'pnpm test' },
  });
  assert.equal(trial.trace.events[3].actor, 'agent');
  assert.equal(trial.trace.events[3].data.success, true);
  assert.deepEqual(trial.trace.events[2].source?.payload, start);
  assert.equal(JSON.stringify(trial).includes('PRIVATE_REASONING'), false);
  assert.equal(JSON.stringify(evidence), original);
  assert.equal(trial.outcome.localUrl, evidence.localUrl);
  assert.equal(trial.task.metadata?.targetFile, 'form.tsx');
  assert.deepEqual(trial.trace.contexts, [context]);
  assert.deepEqual(trial.metadata.environment, { contextCaptureGaps: [] });
  assert.deepEqual(environment.recordedContexts, [context]);
});

test('incomplete or changed historical contexts retain their original recorded data and explicit gaps', () => {
  const rawContexts = [
    context,
    { id: 'missing-fields', content: 'Retain incomplete historical context.' },
    { ...context, id: 'wrong-fingerprint', sha256: '0'.repeat(64) },
  ];
  const trial = recordedTrialFromEvidence('context-gaps', recording([settled]), {
    recordedContexts: rawContexts,
    contextCaptureGaps: [],
  });
  assert.equal(trial.trace.complete, false);
  assert.ok(trial.trace.gaps.includes('A historical context record is incomplete.'));
  assert.ok(trial.trace.gaps.some((gap) => gap.includes('wrong-fingerprint')));
  assert.deepEqual(
    (trial.metadata.environment as Record<string, unknown>).recordedContexts,
    rawContexts,
  );
  assert.equal(trial.trace.contexts[1].sha256, context.sha256);
});

test('a finished trace can be complete even when required behavior never happened', () => {
  const trial = recordedTrialFromEvidence(
    'trial-empty-behavior',
    recording([settled]),
    environment,
  );
  assert.equal(trial.trace.complete, true);
  assert.deepEqual(
    trial.trace.events.filter((event) => event.type === 'tool-call'),
    [],
  );
});

test('portable outcomes preserve raw usage and recorded weighted limit accounting', () => {
  const evidence = recording([settled], 'budget_exceeded');
  evidence.agent.limits = { runtimeMs: 3_600_000, maxTurns: 500, maxTokens: 5000 };
  evidence.agent.limitUsage = {
    runtimeMs: 500,
    turns: 3,
    turnsStarted: 4,
    weightedTokens: 5000.1,
    cachedTokenWeight: 0.1,
  };
  evidence.agent.limitHit = { kind: 'maxTokens', threshold: 5000, observed: 5000.1 };
  const trial = recordedTrialFromEvidence('trial-limits', evidence, environment);
  assert.deepEqual(trial.outcome.limits, evidence.agent.limits);
  assert.deepEqual(trial.outcome.limitUsage, evidence.agent.limitUsage);
  assert.deepEqual(trial.outcome.limitHit, evidence.agent.limitHit);
  assert.deepEqual(trial.outcome.usage, evidence.agent.usage);
});

test('legacy contexts, interrupted execution and unmatched tool calls are explicit capture gaps', () => {
  const trial = recordedTrialFromEvidence('trial-interrupted', recording([start], 'timeout'));
  assert.equal(trial.trace.complete, false);
  assert.ok(trial.trace.gaps.some((gap) => gap.includes('timeout')));
  assert.ok(trial.trace.gaps.some((gap) => gap.includes('Historical instruction')));
  assert.ok(trial.trace.gaps.some((gap) => gap.includes('no recorded result')));
  assert.deepEqual(trial.trace.contexts, []);
});

test('evaluator results cannot close agent calls and duplicate results are capture gaps', () => {
  const evidence = recording([start, end, settled]);
  evidence.events[1].actor = 'evaluator';
  const mismatched = recordedTrialFromEvidence('trial-attribution', evidence, environment);
  assert.equal(mismatched.trace.events[1].actor, 'evaluator');
  assert.equal(mismatched.trace.complete, false);
  assert.match(mismatched.trace.gaps.join(' '), /no recorded call from the same actor/);
  assert.match(mismatched.trace.gaps.join(' '), /agent:c1 has no recorded result/);
  const duplicate = recordedTrialFromEvidence(
    'trial-duplicate',
    recording([start, end, end, settled]),
    environment,
  );
  assert.equal(duplicate.trace.complete, false);
  assert.match(duplicate.trace.gaps.join(' '), /Duplicate tool result/);
});

test('truncated command output is complete only with the validated full attachment', () => {
  const content = 'Tests passed\nDetailed output not included in the native excerpt.';
  const output = {
    path: 'native-output:c1',
    sha256: hash(content),
    kind: 'command-output',
    encoding: 'utf8',
  };
  const truncated = {
    ...end,
    result: {
      ...end.result,
      details: {
        truncation: { truncated: true },
        evaluation: { kind: 'bash', exitCode: 0, outputCapture: output },
      },
    },
  };
  const evidence = recording([start, truncated, settled]);
  const missing = recordedTrialFromEvidence('trial-missing', evidence, environment);
  assert.equal(missing.trace.complete, false);
  assert.ok(missing.trace.gaps.some((gap) => gap.includes('full output was not captured')));
  evidence.artifacts.push({
    id: 'full-output',
    path: output.path,
    content,
    sha256: hash(content),
    observedBy: 'evaluator',
  });
  const complete = recordedTrialFromEvidence('trial-output', evidence, environment);
  assert.equal(complete.trace.complete, true);
  assert.equal(complete.trace.events[1].data.text, 'Tests passed');
  assert.equal(complete.trace.events[1].data.fullOutputRef, 'full-output');
  assert.equal(complete.trace.artifacts[0].content, content);
  evidence.artifacts[0].content = 'tampered';
  assert.equal(
    recordedTrialFromEvidence('trial-tampered', evidence, environment).trace.complete,
    false,
  );
});

test('partial text survives interruption without converting reasoning deltas into speech', () => {
  const trial = recordedTrialFromEvidence(
    'trial-partial',
    recording(
      [
        {
          type: 'message_update',
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: 'The first probe shows' },
              { type: 'thinking', thinking: 'PRIVATE' },
            ],
          },
          assistantMessageEvent: { type: 'thinking_delta', delta: 'PRIVATE' },
        },
      ],
      'cancelled',
    ),
    environment,
  );
  assert.equal(trial.trace.events[0].type, 'message');
  assert.equal(trial.trace.events[0].data.text, 'The first probe shows');
  assert.equal(trial.trace.events[0].data.partial, true);
  assert.equal(JSON.stringify(trial).includes('PRIVATE'), false);
  assert.equal(trial.trace.complete, false);
});

test('final artifact references survive collisions and validation selects the saved final revision', () => {
  const before = 'original form';
  const final = 'repaired form';
  const evidence = recording([
    start,
    {
      ...end,
      result: {
        ...end.result,
        details: {
          evaluation: {
            kind: 'bash',
            exitCode: 0,
            targetBeforeHash: hash(final),
            targetAfterHash: hash(final),
          },
        },
      },
    },
    settled,
  ]);
  const artifact = (id: string, content: string) => ({
    id,
    path: 'form.tsx',
    content,
    sha256: hash(content),
    observedBy: 'evaluator' as const,
  });
  evidence.beforeArtifacts = [artifact('target', before), artifact('target-3', 'collision')];
  evidence.artifacts = [artifact('target', final)];
  evidence.patch = { ...artifact('target', 'patch content'), path: 'changes.diff' };
  const trial = recordedTrialFromEvidence('trial-collision', evidence, environment);
  const refs = trial.outcome.artifacts as string[];
  assert.equal(trial.trace.complete, true);
  assert.equal(new Set(trial.trace.artifacts.map((item) => item.id)).size, 4);
  assert.deepEqual(refs, ['target-4']);
  assert.equal(trial.trace.artifacts.find((item) => item.id === refs[0])?.content, final);
  assert.equal(
    trial.trace.artifacts.find((item) => item.id === trial.outcome.patch)?.path,
    'changes.diff',
  );
  trial.task.metadata = {
    validation: { required: true, targetFile: 'form.tsx', requiredChecks: ['test'] },
  };
  const validation = prepareValidationHistory(trial)[0];
  assert.equal(validation.data.finalArtifact?.content, final);
  assert.equal(checkValidationOrder(validation).verdict, 'pass');
});
