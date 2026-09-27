import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { normalizePiEvent } from '../src/adapters/pi-evidence.ts';
import type { RecordedTrial, TraceEvent } from '../src/domain/library.ts';
import { extractChainedBrowserSnapshot } from '../src/examples/chained-browser-evidence.ts';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const snapshot = '- alert: Invalid email or password.\n- button "Sign in"';
const explicit = `### Page\n- Page URL: http://127.0.0.1:3456/admin/login\n- Page Title: Login\n### Snapshot\n\`\`\`yaml\n${snapshot}\n\`\`\`\n`;
const automatic = `### Page\n- Page URL: http://127.0.0.1:3456/admin/login\n- Page Title: Login\n### Snapshot\n- [Snapshot](.playwright-cli/earlier.yml)\n`;
const command =
  'playwright-cli -s=trial fill e26 synthetic@example.test && playwright-cli -s=trial fill e28 synthetic-password && playwright-cli -s=trial click e29 && sleep 2 && playwright-cli -s=trial snapshot';

function fixture(
  options: {
    command?: string;
    output?: string;
    toolText?: string;
    truncated?: boolean;
    success?: boolean;
    exitCode?: number;
  } = {},
) {
  const content = options.output ?? automatic + explicit;
  const capture = {
    path: 'native-output:native-call',
    sha256: hash(content),
    kind: 'command-output',
    encoding: 'utf8',
  };
  const rawCall = {
    type: 'tool_execution_start',
    toolName: 'bash',
    toolCallId: 'native-call',
    args: { command: options.command ?? command },
  };
  const rawResult = {
    type: 'tool_execution_end',
    toolName: 'bash',
    toolCallId: 'native-call',
    isError: options.success === false,
    result: {
      content: [{ type: 'text', text: options.toolText ?? content }],
      details: {
        truncation: { truncated: options.truncated === true },
        evaluation: {
          kind: 'bash',
          exitCode: options.exitCode ?? (options.success === false ? 1 : 0),
          targetBeforeHash: '1'.repeat(64),
          targetAfterHash: '1'.repeat(64),
          outputCapture: capture,
        },
      },
    },
  };
  const call: TraceEvent = {
    id: 'call',
    sequence: 1,
    timestamp: '2026-09-27T00:00:00Z',
    actor: 'agent',
    type: 'tool-call',
    data: { callId: rawCall.toolCallId, name: 'bash', args: structuredClone(rawCall.args) },
    source: { kind: 'pi', payload: rawCall },
  };
  const result: TraceEvent = {
    id: 'result',
    sequence: 2,
    timestamp: '2026-09-27T00:00:01Z',
    actor: 'agent',
    type: 'tool-result',
    data: {},
    source: { kind: 'pi', payload: rawResult },
  };
  const observation = normalizePiEvent({ ...result, kind: 'pi', data: rawResult }).observation;
  assert.equal(observation?.type, 'tool_completed');
  if (observation?.type !== 'tool_completed') throw new Error('Invalid test observation');
  result.data = {
    callId: observation.callId,
    success: observation.success,
    text: observation.text,
    truncated: observation.truncated,
    receipt: observation.receipt,
    fullOutputRef: 'full-output',
    outputCapture: structuredClone(capture),
  };
  const trial: RecordedTrial = {
    id: 'trial',
    task: { id: 'task', version: 1, prompt: 'Check login retry.' },
    status: 'completed',
    trace: {
      events: [call, result],
      artifacts: [{ id: 'full-output', path: capture.path, sha256: capture.sha256, content }],
      contexts: [],
      complete: true,
      gaps: [],
    },
    outcome: {},
    metadata: {},
  };
  return { trial, call, result, rawCall, rawResult, capture };
}
type Fixture = ReturnType<typeof fixture>;
const extract = ({ trial, call, result }: Fixture) =>
  extractChainedBrowserSnapshot(trial, call, result);

test('native chain derives explicit snapshot from full output with its exact artifact source', () => {
  const data = fixture();
  const before = JSON.stringify(data.trial);
  const actual = extract(data)!;
  assert.equal(actual.unknown, undefined);
  assert.deepEqual(actual.snapshot, {
    content: snapshot,
    sha256: hash(snapshot),
    sourceRef: 'full-output',
  });
  assert.deepEqual(actual.browser?.pageUrls, [
    'http://127.0.0.1:3456/admin/login',
    'http://127.0.0.1:3456/admin/login',
  ]);
  assert.equal(actual.browser?.hasError, false);
  assert.equal(JSON.stringify(data.trial), before);
  assert.equal(data.trial.trace.artifacts.length, 1, 'No invented snapshot file is added');
});

test('unsupported commands cannot gain snapshot credit from convincingly formatted output', () => {
  for (const command of [
    'echo "playwright-cli snapshot"',
    'cat saved-output && playwright-cli snapshot',
    'playwright-cli run-code "page.goto(location)" && playwright-cli snapshot',
    'playwright-cli snapshot; true',
    'playwright-cli goto $LOCAL_URL && playwright-cli snapshot',
  ])
    assert.equal(extract(fixture({ command })), undefined, command);
});

test('native chain requires exact call/result correspondence and unique actor pairing', () => {
  const mutations: Array<(value: Fixture) => void> = [
    ({ call }) => {
      call.source = undefined;
    },
    ({ result }) => {
      result.source!.kind = 'agent-assertion';
    },
    ({ result }) => {
      result.actor = 'evaluator';
    },
    ({ result }) => {
      result.sequence = 0;
    },
    ({ result }) => {
      result.data.callId = 'other';
    },
    ({ rawCall }) => {
      rawCall.args.command = 'echo forged';
    },
    ({ rawResult }) => {
      rawResult.toolName = 'read';
    },
    ({ rawResult }) => {
      rawResult.result.content[0].text = 'different native text';
    },
    ({ result }) => {
      result.data.success = false;
    },
    ({ result, rawResult }) => {
      delete (rawResult as Record<string, unknown>).isError;
      result.data.success = 'unknown';
    },
    ({ result }) => {
      (result.data.receipt as Record<string, unknown>).exitCode = 1;
    },
    ({ trial, result }) => {
      trial.trace.events.push({ ...result, id: 'duplicate-result' });
    },
    ({ trial, call }) => {
      trial.trace.events.push({ ...call, id: 'duplicate-call' });
    },
  ];
  for (const mutate of mutations) {
    const value = fixture();
    mutate(value);
    assert.ok(extract(value)?.unknown);
  }
  const value = fixture();
  assert.ok(extractChainedBrowserSnapshot(value.trial, value.call, undefined)?.unknown);
  value.trial.trace.events.pop();
  assert.ok(extract(value)?.unknown);
});

test('full output must match both native capture and stored artifact identity and hash', () => {
  const mutations: Array<(value: Fixture) => void> = [
    ({ result }) => {
      delete result.data.outputCapture;
    },
    ({ rawResult }) => {
      delete (rawResult.result.details.evaluation as Record<string, unknown>).outputCapture;
    },
    ({ rawResult, result }) => {
      delete (rawResult.result.details.evaluation as Record<string, unknown>).outputCapture;
      delete result.data.outputCapture;
    },
    ({ result }) => {
      result.data.fullOutputRef = 'missing';
    },
    ({ capture }) => {
      capture.sha256 = '2'.repeat(64);
    },
    ({ trial }) => {
      trial.trace.artifacts[0].content += 'changed';
    },
    ({ trial }) => {
      trial.trace.artifacts[0].sha256 = '2'.repeat(64);
    },
    ({ trial }) => {
      trial.trace.artifacts[0].path = 'native-output:other';
    },
    ({ trial }) => {
      trial.trace.artifacts.push({ ...trial.trace.artifacts[0] });
    },
    ({ capture, result }) => {
      capture.encoding = 'base64';
      result.data.outputCapture = { ...capture };
    },
    ({ capture, result }) => {
      capture.kind = 'read-source';
      result.data.outputCapture = { ...capture };
    },
    ({ capture, result, trial }) => {
      capture.path = 'native-output:other';
      result.data.outputCapture = { ...capture };
      trial.trace.artifacts[0].path = capture.path;
    },
  ];
  for (const mutate of mutations) {
    const value = fixture();
    mutate(value);
    assert.match(extract(value)?.unknown ?? '', /hash-verified/);
  }
});

test('truncated native excerpts are resolved only by their verified full command output', () => {
  const value = fixture({ truncated: true, toolText: '...truncated excerpt...' });
  assert.equal(extract(value)?.snapshot?.content, snapshot);
  value.trial.trace.artifacts = [];
  assert.match(extract(value)?.unknown ?? '', /hash-verified/);
});

test('final explicit snapshot requires its own immediately preceding Page report and no trailer', () => {
  for (const output of [
    automatic + `### Snapshot\n\`\`\`yaml\n${snapshot}\n\`\`\`\n`,
    explicit + `### Snapshot\n\`\`\`yaml\n${snapshot}\n\`\`\`\n`,
    explicit + '### Ran Playwright code\n```js\nconsole.log("fake")\n```\n',
    explicit + 'extra output\n',
    explicit + '### Page\n- Missing URL\n',
    automatic,
    '### Snapshot\n```yaml\n' + snapshot + '\n```\n',
  ]) {
    const actual = extract(fixture({ output }));
    assert.match(actual?.unknown ?? '', /final explicit snapshot/);
    assert.equal(actual?.snapshot, undefined);
  }
  assert.equal(
    extract(fixture({ output: explicit.replaceAll('\n', '\r\n') }))?.snapshot?.content,
    snapshot.replaceAll('\n', '\r\n'),
  );
});

test('observed execution failures stay failures without inventing a missing-snapshot limitation', () => {
  for (const options of [{ success: false }, { exitCode: 1 }]) {
    const value = fixture({ ...options, output: 'CLI execution failed' });
    value.trial.trace.artifacts = [];
    assert.deepEqual(extract(value), {});
  }
});

test('native CLI error markers and the actual final URL remain observable for the grader', () => {
  const value = fixture({ output: '### Error\nNavigation failed\n' + explicit });
  assert.equal(extract(value)?.browser?.hasError, true);
  const other = fixture({
    output:
      automatic + explicit.replace('http://127.0.0.1:3456/admin/login', 'https://example.test/'),
  });
  assert.equal(extract(other)?.browser?.pageUrls.at(-1), 'https://example.test/');
});
