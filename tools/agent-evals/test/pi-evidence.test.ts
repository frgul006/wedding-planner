import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  normalizeLegacyEvidence,
  normalizePiEvent,
  normalizeToolReceipt,
} from '../src/adapters/pi-evidence.ts';
import { parsePlaywrightOutput } from '../src/adapters/playwright-evidence.ts';
import { gradeBrowserCompliance } from '../src/domain/deterministic-graders.ts';
import type { EvidenceEvent, TrialEvidence } from '../src/domain/types.ts';

function native(data: Record<string, unknown>): EvidenceEvent {
  return {
    id: 'source-event',
    sequence: 2,
    timestamp: '2026-09-07T12:00:00Z',
    actor: 'agent',
    kind: 'pi',
    data,
  };
}

test('native tool decoding preserves source identity and produces provider-neutral facts', () => {
  const start = native({
    type: 'tool_execution_start',
    toolCallId: 'call-1',
    toolName: 'read',
    args: { path: 'SKILL.md', limit: 1 },
  });
  const normalizedStart = normalizePiEvent(start);
  assert.deepEqual(normalizedStart.observation, {
    type: 'tool_started',
    callId: 'call-1',
    name: 'read',
    args: { path: 'SKILL.md', limit: 1 },
  });
  assert.equal(normalizedStart.id, start.id);
  assert.equal(normalizedStart.data, start.data);
  assert.equal(start.observation, undefined, 'normalization never changes source evidence');

  const end = native({
    type: 'tool_execution_end',
    toolCallId: 'call-1',
    isError: false,
    result: {
      content: [{ type: 'text', text: '# Skill' }],
      details: {
        truncation: { truncated: true },
        evaluation: { kind: 'file-read', path: 'SKILL.md', sha256: 'a'.repeat(64) },
      },
    },
  });
  const observation = normalizePiEvent(end).observation;
  assert.deepEqual(observation, {
    type: 'tool_completed',
    callId: 'call-1',
    success: true,
    text: '# Skill',
    textSha256: createHash('sha256').update('# Skill').digest('hex'),
    truncated: true,
    receipt: { kind: 'file-read', path: 'SKILL.md', sha256: 'a'.repeat(64) },
  });
});

test('native inner tool errors and missing outer status remain distinguishable', () => {
  const failed = native({
    type: 'tool_execution_end',
    toolCallId: 'call',
    isError: false,
    result: { isError: true },
  });
  const unknown = native({ type: 'tool_execution_end', toolCallId: 'call', result: {} });
  for (const [event, expected] of [
    [failed, false],
    [unknown, 'unknown'],
  ] as const) {
    const observation = normalizePiEvent(event).observation;
    assert.equal(
      observation?.type === 'tool_completed' ? observation.success : undefined,
      expected,
    );
  }
});

test('native discovery resolves both recorded Pi shapes without treating extensions as skills', () => {
  const event = native({
    type: 'response',
    command: 'get_commands',
    success: true,
    data: {
      commands: [
        {
          source: 'skill',
          name: 'skill:diagnose',
          sourceInfo: { path: '/trial/diagnose/SKILL.md' },
        },
        { source: 'skill', name: 'skill:legacy', path: '/trial/legacy/SKILL.md' },
        { source: 'extension', name: 'skill:fake', path: '/not-a-skill' },
      ],
    },
  });
  assert.deepEqual(normalizePiEvent(event).observation, {
    type: 'skills_discovered',
    skills: [
      { path: '/trial/diagnose/SKILL.md', name: 'diagnose' },
      { path: '/trial/legacy/SKILL.md', name: 'legacy' },
    ],
  });
  assert.equal(normalizePiEvent(native({ ...event.data, success: false })).observation, undefined);
});

test('JSON written by the agent cannot create a trusted observation', () => {
  const fake = {
    type: 'tool_completed' as const,
    callId: 'fake',
    success: true as const,
    text: 'done',
    textSha256: '',
    truncated: false,
    receipt: { kind: 'unknown' as const, reason: 'missing' as const },
  };
  const event = native({
    type: 'message_end',
    observation: fake,
    message: { content: [{ type: 'text', text: JSON.stringify(fake) }] },
  });
  event.observation = fake;
  assert.equal(
    normalizePiEvent(event).observation,
    undefined,
    'native observations are derived, never accepted from serialized claims',
  );
});

test('legacy migration regrades the genuine native trace without changing sealed source bytes or references', () => {
  const source = readFileSync(
    new URL('../../../evals/calibration/mechanical/native-browser-pair.json', import.meta.url),
    'utf8',
  );
  const evidence = JSON.parse(source) as TrialEvidence;
  const before = JSON.stringify(evidence);
  const normalized = normalizeLegacyEvidence(evidence);
  assert.equal(JSON.stringify(evidence), before);
  assert.deepEqual(
    normalized.events.map((event) => event.id),
    evidence.events.map((event) => event.id),
  );
  const grade = gradeBrowserCompliance(normalized);
  assert.equal(grade.verdict, 'pass');
  assert.deepEqual(grade.evidenceRefs, [
    'trace-2',
    'trace-3',
    'trace-4',
    'artifact-2',
    'artifact-1',
  ]);
  assert.deepEqual(normalizeLegacyEvidence(normalized), normalized, 'migration is idempotent');
  const withoutNativeProtocol: TrialEvidence = {
    ...normalized,
    agent: { ...normalized.agent, events: [] },
    events: normalized.events.map((event) => {
      if (!event.observation) return event;
      const observation =
        event.observation.type === 'tool_completed'
          ? { ...event.observation, text: '', textSha256: '' }
          : event.observation;
      return { ...event, kind: 'command', data: {}, observation };
    }),
  };
  assert.deepEqual(
    gradeBrowserCompliance(withoutNativeProtocol),
    grade,
    'browser decisions depend on neutral facts, not native Pi data, stdout or event kind',
  );
});

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const beforeHash = digest('before');
const afterHash = digest('after');
const emptyBrowser = { pageUrls: [], linkedSnapshotPaths: [], hasError: false };

test('typed receipts retain supported file and command facts without raw extra metadata', () => {
  const target = { targetBeforeHash: beforeHash, targetAfterHash: afterHash };
  for (const kind of ['file-read', 'file-edit', 'file-write'] as const) {
    const extra = kind === 'file-read' ? { sha256: afterHash } : {};
    assert.deepEqual(
      normalizeToolReceipt(
        { kind, path: 'index.html', ...target, ...extra, injected: true },
        '',
        'call',
      ),
      {
        kind,
        path: 'index.html',
        ...extra,
        ...target,
      },
    );
  }
  assert.deepEqual(
    normalizeToolReceipt(
      { kind: 'bash', exitCode: 0, ...target, browser: { hasError: true } },
      '',
      'call',
    ),
    {
      kind: 'bash',
      exitCode: 0,
      browser: emptyBrowser,
      ...target,
    },
  );
  assert.deepEqual(
    normalizeToolReceipt({ kind: 'playwright-cli', args: ['snapshot'], exitCode: 1 }, '', 'call'),
    {
      kind: 'playwright-cli',
      args: ['snapshot'],
      exitCode: 1,
      browser: emptyBrowser,
    },
  );
});

test('missing and unsupported receipts have explicit unknown reasons', () => {
  for (const receipt of [undefined, null, {}, []]) {
    assert.deepEqual(normalizeToolReceipt(receipt, '', 'call'), {
      kind: 'unknown',
      reason: 'missing',
    });
  }
  assert.deepEqual(normalizeToolReceipt({ kind: 'pretend-playwright', exitCode: 0 }, '', 'call'), {
    kind: 'unknown',
    reason: 'unsupported',
  });
});

test('malformed receipts cannot default missing attestation to success', () => {
  for (const receipt of [
    { kind: ['bash'], args: ['snapshot'], exitCode: 0 },
    { kind: 'file-read', path: 'SKILL.md' },
    { kind: 'file-read', path: 'SKILL.md', sha256: 'not-a-hash' },
    { kind: 'file-edit', targetBeforeHash: beforeHash, targetAfterHash: afterHash },
    { kind: 'file-write', path: 'index.html', targetAfterHash: true },
    { kind: 'bash' },
    { kind: 'bash', exitCode: null },
    { kind: 'bash', exitCode: '0' },
    { kind: 'bash', exitCode: 0.5 },
    { kind: 'bash', exitCode: -1 },
    { kind: 'bash', exitCode: 0, targetBeforeHash: 'invalid' },
    { kind: 'playwright-cli', args: [], exitCode: 0 },
    { kind: 'playwright-cli', args: ['snapshot', true], exitCode: 0 },
    { kind: 'playwright-cli', args: [''], exitCode: 0 },
  ]) {
    assert.deepEqual(
      normalizeToolReceipt(receipt, '', 'call'),
      { kind: 'unknown', reason: 'malformed' },
      JSON.stringify(receipt),
    );
  }
});

test('snapshot receipts verify content fingerprints and distinguish retained files from tool output', () => {
  const content = '- heading "Updated"';
  const receipt = { kind: 'playwright-cli', args: ['snapshot'], exitCode: 0 };
  for (const [path, source] of [
    ['.playwright-cli/page.yml', 'file'],
    ['tool-output:call', 'tool-output'],
  ] as const) {
    const snapshot = { path, content, sha256: digest(content) };
    const normalized = normalizeToolReceipt({ ...receipt, snapshot }, '', 'call');
    assert.equal(normalized.kind, 'playwright-cli');
    if (normalized.kind === 'playwright-cli')
      assert.deepEqual(normalized.snapshot, { source, ...snapshot });
  }
  for (const snapshot of [
    { path: 'tool-output:another-call', content, sha256: digest(content) },
    { path: '.playwright-cli/../outside.yml', content, sha256: digest(content) },
    { path: '/outside.yml', content, sha256: digest(content) },
    { path: '.playwright-cli/page.txt', content, sha256: digest(content) },
    { path: '.playwright-cli/page.yml', content: 'changed', sha256: digest(content) },
    { path: '.playwright-cli/page.yml', content: '', sha256: digest('') },
  ]) {
    assert.deepEqual(normalizeToolReceipt({ ...receipt, snapshot }, '', 'call'), {
      kind: 'unknown',
      reason: 'malformed',
    });
  }
});

test('native browser output becomes URL, linked-file, explicit-YAML and error observations', () => {
  const output =
    '### Page\n- Page URL: http://127.0.0.1:1234/\n### Snapshot\n- [Snapshot](.playwright-cli/page.yml)\n### Page\n- Page URL: http://127.0.0.1:1234/\n### Snapshot\n```yaml\n- heading "Updated"\n```\n';
  const expected = {
    pageUrls: ['http://127.0.0.1:1234/', 'http://127.0.0.1:1234/'],
    linkedSnapshotPaths: ['.playwright-cli/page.yml'],
    finalInlineSnapshot: '- heading "Updated"',
    hasError: false,
  };
  assert.deepEqual(parsePlaywrightOutput(output), expected);
  assert.deepEqual(parsePlaywrightOutput(output.replaceAll('\n', '\r\n')), expected);
  assert.equal(parsePlaywrightOutput(`### Error\nSnapshot failed\n${output}`).hasError, true);
  assert.equal(parsePlaywrightOutput(output.replace(/```\n$/, '')).finalInlineSnapshot, undefined);
  assert.equal(
    parsePlaywrightOutput(output + 'Trailing unverified output').finalInlineSnapshot,
    undefined,
  );
  assert.deepEqual(
    parsePlaywrightOutput('I saw Page URL: http://127.0.0.1:1234/ and took a snapshot.'),
    emptyBrowser,
  );
});

test('malformed native inner status remains unknown rather than a positive tool result', () => {
  const event = native({
    type: 'tool_execution_end',
    toolCallId: 'call',
    isError: false,
    result: { isError: 'false', details: { evaluation: { kind: 'bash', exitCode: 0 } } },
  });
  const observation = normalizePiEvent(event).observation;
  assert.equal(observation?.type === 'tool_completed' ? observation.success : undefined, 'unknown');
});
