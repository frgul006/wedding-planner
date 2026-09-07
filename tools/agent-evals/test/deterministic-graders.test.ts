import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import * as graders from '../src/domain/deterministic-graders.js';
import { normalizeLegacyEvidence } from '../src/adapters/pi-evidence.ts';
import type { Actor, EvidenceEvent, TrialEvidence } from '../src/domain/types.js';

// Native trace fixtures stay native. Exercise the same adapter migration as the
// saved-run loader before making domain decisions, including mutated traces.
const gradeBrowserBehavior = (evidence: TrialEvidence) =>
  graders.gradeBrowserBehavior(normalizeLegacyEvidence(evidence));
const gradeBrowserCompliance = (evidence: TrialEvidence) =>
  graders.gradeBrowserCompliance(normalizeLegacyEvidence(evidence));
const gradeOutcome = (evidence: TrialEvidence) =>
  graders.gradeOutcome(normalizeLegacyEvidence(evidence));
const gradeTrial = (evidence: TrialEvidence) =>
  graders.gradeTrial(normalizeLegacyEvidence(evidence));
const observeSkills = (evidence: TrialEvidence) =>
  graders.observeSkills(normalizeLegacyEvidence(evidence));
const hash = (content: string) => createHash('sha256').update(content).digest('hex');

const EXPECTED = 'Plan your wedding together';
const SNAPSHOT = `- main:\n  - heading "${EXPECTED}" [level=1]\n`;
const SNAPSHOT_PATH = '.playwright-cli/page-2026-09-07T12-00-00-000Z.yml';
const SNAPSHOT_HASH = hash(SNAPSHOT);

function nativeBrowserPair(): TrialEvidence {
  return JSON.parse(
    readFileSync(
      new URL('../../../evals/calibration/mechanical/native-browser-pair.json', import.meta.url),
      'utf8',
    ),
  ) as TrialEvidence;
}

function fixture(): TrialEvidence {
  return {
    task: {
      id: 'welcome-copy',
      version: '1',
      kind: 'ui',
      prompt: 'Improve the welcome heading.',
      targetFile: 'app/page.tsx',
      expectedText: EXPECTED,
      flowPath: '/',
    },
    variant: 'enabled',
    localUrl: 'http://127.0.0.1:43123/',
    events: [],
    artifacts: [],
    agent: {
      status: 'completed',
      startedAt: '2026-09-07T12:00:00Z',
      endedAt: '2026-09-07T12:00:01Z',
      exitCode: 0,
      signal: null,
      model: null,
      thinkingLevel: null,
      events: [],
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        estimatedCostUsd: null,
        costSource: 'offline fixture',
      },
    },
  };
}

function event(
  evidence: TrialEvidence,
  data: Record<string, unknown>,
  actor: Actor = 'agent',
  kind: EvidenceEvent['kind'] = 'pi',
): EvidenceEvent {
  const sequence = evidence.events.length + 1;
  const value: EvidenceEvent = {
    id: `event-${sequence}`,
    sequence,
    timestamp: '2026-09-07T12:00:00Z',
    actor,
    kind,
    data,
  };
  evidence.events.push(value);
  return value;
}

function tool(
  evidence: TrialEvidence,
  name: string,
  args: Record<string, unknown>,
  evaluation: Record<string, unknown> = {},
  options: { actor?: Actor; isError?: boolean; text?: string } = {},
) {
  const id = `call-${evidence.events.length + 1}`;
  event(
    evidence,
    { type: 'tool_execution_start', toolCallId: id, toolName: name, args },
    options.actor,
  );
  return event(
    evidence,
    {
      type: 'tool_execution_end',
      toolCallId: id,
      isError: options.isError ?? false,
      result: {
        content: [{ type: 'text', text: options.text ?? 'Completed' }],
        details: { evaluation },
      },
    },
    options.actor,
  );
}

function change(evidence: TrialEvidence, before = 'initial', after = 'changed') {
  return tool(
    evidence,
    'edit',
    { path: evidence.task.targetFile, oldText: 'Welcome', newText: EXPECTED },
    {
      kind: 'file-edit',
      path: evidence.task.targetFile,
      targetBeforeHash: hash(before),
      targetAfterHash: hash(after),
    },
  );
}

function browser(
  evidence: TrialEvidence,
  args: string[],
  options: { actor?: Actor; isError?: boolean; text?: string; exitCode?: number } = {},
) {
  const action = args.find((arg) => !arg.startsWith('-'));
  const receipt: Record<string, unknown> = {
    kind: 'playwright-cli',
    args,
    exitCode: options.exitCode ?? 0,
    targetBeforeHash: hash('changed'),
    targetAfterHash: hash('changed'),
  };
  if (action === 'snapshot')
    receipt.snapshot = { path: SNAPSHOT_PATH, content: SNAPSHOT, sha256: SNAPSHOT_HASH };
  return tool(evidence, 'bash', { command: `playwright-cli ${args.join(' ')}` }, receipt, {
    ...options,
    text:
      options.text ??
      `### Page\n- Page URL: ${evidence.localUrl}\n### Snapshot\n[Snapshot](${SNAPSHOT_PATH})`,
  });
}

function artifact(evidence: TrialEvidence) {
  evidence.artifacts.push({
    id: 'snapshot-1',
    path: SNAPSHOT_PATH,
    sha256: SNAPSHOT_HASH,
    content: SNAPSHOT,
    observedBy: 'evaluator',
  });
  evidence.artifacts.push({
    id: 'final-target',
    path: evidence.task.targetFile,
    sha256: hash('changed'),
    content: `<h1>${EXPECTED}</h1>`,
    observedBy: 'evaluator',
  });
}

function passing(): TrialEvidence {
  const evidence = fixture();
  change(evidence);
  browser(evidence, ['-s=trial', 'open', evidence.localUrl]);
  browser(evidence, ['-s=trial', 'snapshot']);
  artifact(evidence);
  return evidence;
}

test('known passing trace requires attested agent commands and the captured snapshot', () => {
  const evidence = passing();
  assert.equal(gradeBrowserCompliance(evidence).verdict, 'pass');
  assert.deepEqual(gradeBrowserCompliance(evidence).evidenceRefs, [
    'event-2',
    'event-4',
    'event-6',
    'snapshot-1',
    'final-target',
  ]);
  evidence.agent.events = [...evidence.events];
  assert.equal(
    gradeBrowserCompliance(evidence).verdict,
    'pass',
    'duplicate log copies do not change grading',
  );
});

test('native explicit inline YAML snapshot is valid with independently captured matching artifact', () => {
  const evidence = passing();
  const last = evidence.events.at(-1)!;
  const result = last.data.result as {
    content: Array<{ text: string }>;
    details: { evaluation: { snapshot: { path: string } } };
  };
  result.details.evaluation.snapshot.path = `tool-output:${last.data.toolCallId}`;
  result.content[0].text = `### Page\n- Page URL: ${evidence.localUrl}\n### Snapshot\n\`\`\`yaml\n${SNAPSHOT}\`\`\``;
  evidence.artifacts[0].path = `tool-output:${last.data.toolCallId}`;
  assert.equal(gradeBrowserCompliance(evidence).verdict, 'pass');
  evidence.artifacts[0].path = 'tool-output:another-command';
  assert.equal(gradeBrowserCompliance(evidence).verdict, 'unknown');
});

test('real native navigation && snapshot trace can be regraded without rerunning an interrupted trial', () => {
  const evidence = nativeBrowserPair();
  const grade = gradeBrowserCompliance(evidence);
  assert.equal(evidence.agent.status, 'budget_exceeded');
  assert.equal(grade.verdict, 'pass');
  assert.equal(grade.version, '1.4.0');
  assert.deepEqual(grade.evidenceRefs, [
    'trace-2',
    'trace-3',
    'trace-4',
    'artifact-2',
    'artifact-1',
  ]);
});

for (const command of [
  'playwright-cli open http://127.0.0.1:57007 && playwright-cli snapshot',
  'playwright-cli -s=trial goto http://127.0.0.1:57007 && playwright-cli -s=trial snapshot',
  'playwright-cli --session trial goto http://127.0.0.1:57007 && playwright-cli --session=trial snapshot',
]) {
  test(`literal browser pair recognizes only equivalent session-preserving grammar: ${command}`, () => {
    const evidence = nativeBrowserPair();
    evidence.events[2].data.args = { command };
    assert.equal(gradeBrowserCompliance(evidence).verdict, 'pass');
  });
}

for (const command of [
  'echo "playwright-cli open http://127.0.0.1:57007 && playwright-cli snapshot"',
  'playwright-cli open http://127.0.0.1:57007 && echo "playwright-cli snapshot"',
  'playwright-cli open http://127.0.0.1:57007 && playwright-cli screenshot',
  'playwright-cli open http://127.0.0.1:57007 && playwright-cli snapshot; true',
  'playwright-cli open http://127.0.0.1:57007 && playwright-cli snapshot && true',
  'playwright-cli open http://127.0.0.1:57007\nplaywright-cli snapshot',
  'playwright-cli open http://127.0.0.1:57007 && playwright-cli snapshot > fake.yml',
  'PATH=/tmp/fake playwright-cli open http://127.0.0.1:57007 && playwright-cli snapshot',
  'playwright-cli open $LOCAL_URL && playwright-cli snapshot',
  '$(echo playwright-cli) open http://127.0.0.1:57007 && playwright-cli snapshot',
  'playwright-cli --config=/tmp/fake open http://127.0.0.1:57007 && playwright-cli snapshot',
  'playwright-cli -s=one open http://127.0.0.1:57007 && playwright-cli -s=two snapshot',
  'playwright-cli -s=one=two open http://127.0.0.1:57007 && playwright-cli -s=one snapshot',
  '/tmp/playwright-cli open http://127.0.0.1:57007 && /tmp/playwright-cli snapshot',
]) {
  test(`spoofed or broader shell commands cannot inherit real browser evidence: ${command}`, () => {
    const evidence = nativeBrowserPair();
    evidence.events[2].data.args = { command };
    assert.notEqual(gradeBrowserCompliance(evidence).verdict, 'pass');
  });
}

test('literal browser pair requires a successful trusted sandbox bash receipt', () => {
  for (const patch of [{ kind: 'untrusted' }, { exitCode: 1 }, { targetBeforeHash: 'other' }]) {
    const evidence = nativeBrowserPair();
    const result = evidence.events[3].data.result as {
      details: { evaluation: Record<string, unknown> };
    };
    Object.assign(result.details.evaluation, patch);
    assert.notEqual(gradeBrowserCompliance(evidence).verdict, 'pass');
  }
});

test('literal browser pair requires two exact native page URLs and matching explicit YAML', () => {
  const fixture = nativeBrowserPair();
  const result = fixture.events[3].data.result as { content: Array<{ text: string }> };
  const output = result.content[0].text;
  for (const text of [
    output.replace('- Page URL: http://127.0.0.1:57007/', '- Page URL: https://example.com/'),
    output.replace(/### Snapshot\n```yaml[\s\S]*$/, ''),
    output.replace('  - link "View the wedding schedule"', '  - link "Details"'),
  ]) {
    const evidence = nativeBrowserPair();
    (evidence.events[3].data.result as { content: Array<{ text: string }> }).content[0].text = text;
    assert.notEqual(gradeBrowserCompliance(evidence).verdict, 'pass');
  }
  fixture.artifacts.find((item) => item.id === 'artifact-2')!.content = 'a forged snapshot';
  assert.notEqual(gradeBrowserCompliance(fixture).verdict, 'pass');
});

test('native explicit snapshot remains captured evidence after the agent cleans up its workspace snapshot files', () => {
  const evidence = nativeBrowserPair();
  evidence.agent.status = 'completed';
  evidence.artifacts = evidence.artifacts.filter((item) => item.path === evidence.task.targetFile);
  tool(
    evidence,
    'bash',
    { command: 'rm -rf .playwright-cli && git status --short --branch' },
    {
      kind: 'bash',
      exitCode: 0,
      targetBeforeHash: evidence.artifacts[0].sha256,
      targetAfterHash: evidence.artifacts[0].sha256,
    },
  );
  const grade = gradeBrowserCompliance(evidence);
  assert.equal(grade.verdict, 'pass');
  assert.deepEqual(grade.evidenceRefs, ['trace-2', 'trace-3', 'trace-4', 'artifact-1']);
  assert.match(grade.reason, /explicit snapshot YAML is preserved in the trusted tool result/);
});

test('missing workspace snapshots cannot rescue absent, truncated, or unsuccessful native inline output', () => {
  for (const patch of [
    'missing-inline',
    'wrong-url',
    'native-error',
    'failed-receipt',
    'changed-target',
  ] as const) {
    const evidence = nativeBrowserPair();
    evidence.agent.status = 'completed';
    evidence.artifacts = evidence.artifacts.filter(
      (item) => item.path === evidence.task.targetFile,
    );
    const result = evidence.events[3].data.result as {
      content: Array<{ text: string }>;
      details: { evaluation: { exitCode: number } };
    };
    if (patch === 'missing-inline')
      result.content[0].text = result.content[0].text.replace(/### Snapshot\n```yaml[\s\S]*$/, '');
    if (patch === 'wrong-url')
      result.content[0].text = result.content[0].text.replace(
        '- Page URL: http://127.0.0.1:57007/',
        '- Page URL: https://example.com/',
      );
    if (patch === 'native-error')
      result.content[0].text = `### Error\nSnapshot error\n${result.content[0].text}`;
    if (patch === 'failed-receipt') result.details.evaluation.exitCode = 1;
    if (patch === 'changed-target') evidence.artifacts[0].sha256 = 'c'.repeat(64);
    assert.notEqual(gradeBrowserCompliance(evidence).verdict, 'pass', patch);
  }
});

test('a retained conflicting file stays unknown despite complete native inline output', () => {
  const evidence = nativeBrowserPair();
  evidence.agent.status = 'completed';
  evidence.artifacts.find((item) => item.path.endsWith('.yml'))!.content =
    '- main: Unexpected replacement';
  assert.equal(gradeBrowserCompliance(evidence).verdict, 'unknown');
});

test('documentation-only applicability is not-applicable even with optional browser use', () => {
  const evidence = passing();
  evidence.task.kind = 'docs';
  assert.equal(gradeBrowserCompliance(evidence).verdict, 'not-applicable');
  assert.equal(gradeBrowserBehavior(evidence).verdict, 'not-applicable');
});

test('disabled instruction has no compliance obligation but browser behavior remains observable', () => {
  const evidence = passing();
  evidence.variant = 'disabled';
  assert.equal(gradeBrowserCompliance(evidence).verdict, 'not-applicable');
  assert.equal(gradeBrowserBehavior(evidence).verdict, 'pass');
});

test('evaluator-run browser commands cannot satisfy the agent instruction', () => {
  const evidence = fixture();
  change(evidence);
  browser(evidence, ['open', evidence.localUrl], { actor: 'evaluator' });
  browser(evidence, ['snapshot'], { actor: 'evaluator' });
  artifact(evidence);
  assert.equal(gradeBrowserCompliance(evidence).verdict, 'fail');
});

test('validation before the final UI change does not satisfy the changed flow requirement', () => {
  const evidence = passing();
  change(evidence, 'changed', 'changed-again');
  assert.equal(gradeBrowserCompliance(evidence).verdict, 'fail');
});

test('a browser opened before the edit can validate updated content with a later explicit snapshot', () => {
  const evidence = fixture();
  browser(evidence, ['open', evidence.localUrl]);
  change(evidence);
  browser(evidence, ['snapshot']);
  artifact(evidence);
  assert.equal(gradeBrowserCompliance(evidence).verdict, 'pass');
});

test('a snapshot captured before the final edit cannot validate the changed flow', () => {
  const evidence = fixture();
  browser(evidence, ['open', evidence.localUrl]);
  browser(evidence, ['snapshot']);
  change(evidence);
  artifact(evidence);
  assert.equal(gradeBrowserCompliance(evidence).verdict, 'fail');
});

for (const url of [
  'https://example.com/',
  'http://localhost:43123/',
  'http://127.0.0.1:43124/',
  'http://127.0.0.1:43123/other',
  'http://127.0.0.1.evil.example:43123/',
  'http://user@127.0.0.1:43123/',
]) {
  test(`navigation must use the exact local origin and changed path: ${url}`, () => {
    const evidence = fixture();
    change(evidence);
    browser(evidence, ['open', url]);
    browser(evidence, ['snapshot']);
    artifact(evidence);
    assert.equal(gradeBrowserCompliance(evidence).verdict, 'fail');
  });
}

test('a reported redirect away from the changed flow is rejected', () => {
  const evidence = fixture();
  change(evidence);
  browser(evidence, ['goto', evidence.localUrl], {
    text: '### Page\n- Page URL: http://127.0.0.1:43123/login\n',
  });
  browser(evidence, ['snapshot']);
  artifact(evidence);
  assert.equal(gradeBrowserCompliance(evidence).verdict, 'fail');
});

test('another browser session cannot inherit a successful navigation', () => {
  const evidence = fixture();
  change(evidence);
  browser(evidence, ['-s=one', 'open', evidence.localUrl]);
  browser(evidence, ['-s=two', 'snapshot']);
  artifact(evidence);
  assert.equal(gradeBrowserCompliance(evidence).verdict, 'fail');
});

test('a navigation-changing action invalidates the known changed flow', () => {
  const evidence = fixture();
  change(evidence);
  browser(evidence, ['open', evidence.localUrl]);
  browser(evidence, ['click', 'e1']);
  browser(evidence, ['snapshot']);
  artifact(evidence);
  assert.equal(gradeBrowserCompliance(evidence).verdict, 'fail');
});

test('unattested browser commands cannot preserve the known session location', () => {
  const evidence = fixture();
  change(evidence);
  browser(evidence, ['open', evidence.localUrl]);
  tool(evidence, 'bash', { command: 'playwright-cli goto https://example.com && true' });
  browser(evidence, ['snapshot']);
  artifact(evidence);
  assert.equal(gradeBrowserCompliance(evidence).verdict, 'unknown');
});

test('the snapshot itself must report the changed local flow', () => {
  const evidence = fixture();
  change(evidence);
  browser(evidence, ['open', evidence.localUrl]);
  browser(evidence, ['snapshot'], { text: '### Page\n- Page URL: https://example.com/\n' });
  artifact(evidence);
  assert.equal(gradeBrowserCompliance(evidence).verdict, 'fail');
});

for (const action of ['open', 'snapshot']) {
  test(`a failed ${action} command is not successful validation`, () => {
    const evidence = fixture();
    change(evidence);
    browser(
      evidence,
      ['open', evidence.localUrl],
      action === 'open' ? { isError: true, exitCode: 1 } : {},
    );
    browser(evidence, ['snapshot'], action === 'snapshot' ? { exitCode: 1 } : {});
    artifact(evidence);
    assert.equal(gradeBrowserCompliance(evidence).verdict, 'fail');
  });
}

test('screenshot and automatically generated navigation snapshots do not replace an explicit snapshot command', () => {
  const evidence = fixture();
  change(evidence);
  browser(evidence, ['open', evidence.localUrl]);
  browser(evidence, ['screenshot']);
  artifact(evidence);
  assert.equal(gradeBrowserCompliance(evidence).verdict, 'fail');
});

test('missing or subsequently overwritten snapshot artifacts are inconclusive', () => {
  const evidence = passing();
  evidence.artifacts[0].content = 'forged replacement';
  assert.equal(gradeBrowserCompliance(evidence).verdict, 'unknown');
  evidence.artifacts = [];
  assert.equal(gradeBrowserCompliance(evidence).verdict, 'unknown');
});

test('a later failed command that changes the target invalidates an earlier validation', () => {
  const evidence = passing();
  tool(
    evidence,
    'bash',
    { command: 'some-write-command' },
    {},
    { isError: true, text: 'Write failed after modifying the file' },
  );
  evidence.artifacts.find((item) => item.id === 'final-target')!.sha256 = 'changed-again';
  assert.equal(gradeBrowserCompliance(evidence).verdict, 'unknown');
});

test('an unobserved target mutation at snapshot time cannot inherit earlier change ordering', () => {
  const evidence = passing();
  const result = evidence.events.at(-1)!.data.result as {
    details: { evaluation: { targetBeforeHash: string; targetAfterHash: string } };
  };
  result.details.evaluation.targetBeforeHash = 'changed-asynchronously';
  result.details.evaluation.targetAfterHash = 'changed-asynchronously';
  evidence.artifacts.find((item) => item.id === 'final-target')!.sha256 = 'changed-asynchronously';
  assert.equal(gradeBrowserCompliance(evidence).verdict, 'unknown');
});

test('a real snapshot of stale content fails the changed-flow check', () => {
  const evidence = passing();
  const last = evidence.events.at(-1)!;
  const result = last.data.result as {
    details: { evaluation: { snapshot: { content: string; sha256: string } } };
  };
  result.details.evaluation.snapshot.content = '- heading "Welcome"';
  result.details.evaluation.snapshot.sha256 = hash('- heading "Welcome"');
  evidence.artifacts[0].content = '- heading "Welcome"';
  evidence.artifacts[0].sha256 = hash('- heading "Welcome"');
  assert.equal(gradeBrowserCompliance(evidence).verdict, 'fail');
});

for (const command of [
  'echo "playwright-cli open http://127.0.0.1:43123/; playwright-cli snapshot"',
  'printf "%s" "playwright-cli snapshot"',
  'echo "I ran playwright-cli snapshot successfully"',
]) {
  test(`command mentions and self-reports cannot pass: ${command}`, () => {
    const evidence = fixture();
    change(evidence);
    tool(evidence, 'bash', { command }, {}, { text: `Snapshot: ${SNAPSHOT_PATH}\n${SNAPSHOT}` });
    artifact(evidence);
    assert.equal(gradeBrowserCompliance(evidence).verdict, 'fail');
  });
}

for (const command of [
  'playwright-cli open http://127.0.0.1:43123/ && playwright-cli snapshot',
  'playwright-cli snapshot || true',
  'playwright-cli snapshot',
  'false; playwright-cli snapshot',
  'bash -c "playwright-cli snapshot"',
  'echo "$(playwright-cli snapshot)"',
]) {
  test(`unattested shell execution stays unknown: ${command}`, () => {
    const evidence = fixture();
    change(evidence);
    tool(evidence, 'bash', { command }, {}, { text: `Snapshot: ${SNAPSHOT_PATH}\n${SNAPSHOT}` });
    artifact(evidence);
    assert.equal(gradeBrowserCompliance(evidence).verdict, 'unknown');
  });
}

for (const status of [
  'timeout',
  'budget_exceeded',
  'infrastructure_error',
  'agent_error',
] as const) {
  test(`${status} remains distinct and missing evidence does not become behavioral failure`, () => {
    const evidence = fixture();
    change(evidence);
    evidence.agent.status = status;
    assert.equal(gradeBrowserCompliance(evidence).verdict, 'unknown');
    const completeBehavior = passing();
    completeBehavior.agent.status = status;
    assert.equal(
      gradeBrowserCompliance(completeBehavior).verdict,
      'pass',
      'already-observed behavior is still known',
    );
  });
}

test('a started tool without a terminal event is incomplete evidence', () => {
  const evidence = fixture();
  change(evidence);
  event(evidence, {
    type: 'tool_execution_start',
    toolCallId: 'unfinished',
    toolName: 'bash',
    args: { command: 'playwright-cli snapshot' },
  });
  assert.equal(gradeBrowserCompliance(evidence).verdict, 'unknown');
});

test('a terminal tool event without the command start is incomplete evidence', () => {
  const evidence = fixture();
  change(evidence);
  event(evidence, {
    type: 'tool_execution_end',
    toolCallId: 'missing-start',
    isError: false,
    result: { content: [{ type: 'text', text: 'Snapshot complete' }] },
  });
  assert.equal(gradeBrowserCompliance(evidence).verdict, 'unknown');
});

test('target outcome uses evaluator-observed files, independently of compliance', () => {
  const evidence = fixture();
  change(evidence);
  event(
    evidence,
    {
      type: 'trial_observation',
      targetFile: evidence.task.targetFile,
      targetBeforeContent: 'Welcome',
      targetAfterContent: `<h1>${EXPECTED}</h1>`,
    },
    'evaluator',
    'lifecycle',
  );
  assert.equal(gradeOutcome(evidence).verdict, 'pass');
  assert.equal(gradeBrowserCompliance(evidence).verdict, 'fail');
  assert.equal(gradeTrial(evidence).length, 3);
});

test('agent-authored outcome claims are not evaluator observations', () => {
  const evidence = fixture();
  event(
    evidence,
    {
      type: 'trial_observation',
      targetFile: evidence.task.targetFile,
      targetAfterContent: EXPECTED,
    },
    'agent',
    'lifecycle',
  );
  assert.equal(gradeOutcome(evidence).verdict, 'unknown');
});

test('completed missing outcome fails; interrupted missing outcome is unknown', () => {
  const evidence = fixture();
  evidence.artifacts.push({
    id: 'target',
    path: evidence.task.targetFile,
    sha256: 'b'.repeat(64),
    content: 'Welcome',
    observedBy: 'evaluator',
  });
  assert.equal(gradeOutcome(evidence).verdict, 'fail');
  evidence.agent.status = 'timeout';
  assert.equal(gradeOutcome(evidence).verdict, 'unknown');
});

test('skill discovery metadata and actual content loading are distinct', () => {
  const evidence = fixture();
  const path = '.agents/skills/diagnose/SKILL.md';
  const content = '# Diagnose\nReproduce the failure before fixing it.';
  const sha256 = hash(content);
  event(
    evidence,
    { type: 'skill_inventory', skills: [{ path, sha256, available: true, discovered: true }] },
    'environment',
    'lifecycle',
  );
  assert.deepEqual(observeSkills(evidence)[0], {
    path,
    sha256,
    available: 'yes',
    discovered: 'yes',
    loaded: 'unknown',
    evidenceRefs: ['event-1'],
  });
  tool(evidence, 'read', { path }, { kind: 'file-read', path, sha256 }, { text: content });
  assert.equal(observeSkills(evidence)[0].loaded, 'yes');
});

test('successful simple cat of a skill is observable loading', () => {
  const evidence = fixture();
  const path = '.agents/skills/diagnose/SKILL.md';
  const content = '# Diagnose\nReproduce the failure before fixing it.';
  event(
    evidence,
    { type: 'skill_inventory', skills: [{ path, sha256: hash(content), available: true }] },
    'environment',
    'lifecycle',
  );
  tool(
    evidence,
    'bash',
    { command: `cat '${path}'` },
    { kind: 'bash', exitCode: 0 },
    { text: content },
  );
  assert.equal(observeSkills(evidence)[0].loaded, 'yes');
  assert.equal(observeSkills(evidence)[0].discovered, 'unknown');
});

for (const scenario of [
  'partial-read',
  'truncated-read',
  'changed-version',
  'receipt-hash-mismatch',
  'unattested-read',
  'unattested-cat',
  'missing-inventory',
] as const) {
  test(`${scenario} does not claim the inventoried skill was fully loaded`, () => {
    const evidence = fixture();
    const path = '.agents/skills/diagnose/SKILL.md';
    const content = '# Diagnose\nReproduce the failure before fixing it.';
    const sha256 = hash(content);
    if (scenario !== 'missing-inventory')
      event(
        evidence,
        { type: 'skill_inventory', skills: [{ path, sha256, available: true }] },
        'environment',
        'lifecycle',
      );
    const receipt =
      scenario === 'unattested-read' || scenario === 'unattested-cat'
        ? {}
        : {
            kind: 'file-read',
            path,
            sha256: ['changed-version', 'receipt-hash-mismatch'].includes(scenario)
              ? hash('Changed skill')
              : sha256,
          };
    const end =
      scenario === 'unattested-cat'
        ? tool(evidence, 'bash', { command: `cat '${path}'` }, receipt, { text: content })
        : tool(
            evidence,
            'read',
            { path, ...(scenario === 'partial-read' ? { offset: 1, limit: 1 } : {}) },
            receipt,
            {
              text:
                scenario === 'partial-read'
                  ? '# Diagnose'
                  : scenario === 'changed-version'
                    ? 'Changed skill'
                    : content,
            },
          );
    if (scenario === 'truncated-read') {
      const result = end.data.result as { details: Record<string, unknown> };
      result.details.truncation = { truncated: true };
    }
    assert.equal(observeSkills(evidence)[0].loaded, 'unknown');
  });
}

test('failed reads, evaluator reads, self-reports, and ambiguous cat commands do not prove skill loading', () => {
  const evidence = fixture();
  const path = '.agents/skills/diagnose/SKILL.md';
  const content = '# Diagnose\nReproduce the failure before fixing it.';
  const sha256 = hash(content);
  const receipt = { kind: 'file-read', path, sha256 };
  event(
    evidence,
    { type: 'skill_inventory', skills: [{ path, sha256, available: true }] },
    'environment',
    'lifecycle',
  );
  tool(evidence, 'read', { path }, receipt, { isError: true, text: content });
  tool(evidence, 'read', { path }, receipt, { actor: 'evaluator', text: content });
  tool(evidence, 'bash', { command: `echo "I loaded ${path}"` }, {}, { text: 'I loaded diagnose' });
  tool(
    evidence,
    'bash',
    { command: `cat ${path}; true` },
    { kind: 'bash', exitCode: 0 },
    { text: content },
  );
  assert.equal(observeSkills(evidence)[0].loaded, 'unknown');
});
