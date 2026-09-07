import type {
  EvidenceEvent,
  Grade,
  TargetFingerprint,
  ToolReceipt,
  TrialEvidence,
} from './types.js';

const VERSION = '1.4.0';
type RecordValue = Record<string, unknown>;
interface ToolExecution {
  start: EvidenceEvent;
  end: EvidenceEvent;
  name: string;
  args: RecordValue;
  text: string;
  textSha256: string;
  truncated: boolean;
  receipt: ToolReceipt;
  success: boolean;
}
interface BrowserCommand {
  action: string;
  args: string[];
  session: string;
}
export interface SkillObservation {
  path: string;
  available: 'yes' | 'no' | 'unknown';
  discovered: 'yes' | 'no' | 'unknown';
  loaded: 'yes' | 'unknown';
  sha256?: string;
  evidenceRefs: string[];
}

function record(value: unknown): RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function events(evidence: TrialEvidence): EvidenceEvent[] {
  // Agent events may also appear in the unified transcript.
  const unique = new Map<string, EvidenceEvent>();
  for (const event of [...evidence.agent.events, ...evidence.events]) unique.set(event.id, event);
  return [...unique.values()].sort((a, b) => a.sequence - b.sequence);
}

function executions(evidence: TrialEvidence): ToolExecution[] {
  const pending = new Map<string, EvidenceEvent>();
  const result: ToolExecution[] = [];
  for (const event of events(evidence)) {
    if (event.actor !== 'agent') continue;
    const observation = event.observation;
    if (observation?.type === 'tool_started') pending.set(observation.callId, event);
    if (observation?.type !== 'tool_completed') continue;
    const start = pending.get(observation.callId);
    if (!start || start.sequence >= event.sequence) continue;
    const command = start.observation;
    if (command?.type !== 'tool_started') continue;
    pending.delete(observation.callId);
    result.push({
      start,
      end: event,
      name: command.name,
      args: command.args,
      text: observation.text,
      textSha256: observation.textSha256,
      truncated: observation.truncated,
      receipt: observation.receipt,
      success: observation.success === true,
    });
  }
  return result;
}

function targetFingerprint(execution: ToolExecution): TargetFingerprint {
  return execution.receipt.kind === 'unknown' ? {} : execution.receipt;
}

function incompleteToolEvidence(evidence: TrialEvidence): boolean {
  const relevant = events(evidence).filter((event) => event.actor === 'agent' && event.observation);
  return relevant.some((event) => {
    const observation = event.observation;
    if (observation?.type === 'tool_completed')
      return (
        observation.success === 'unknown' ||
        !relevant.some(
          (start) =>
            start.observation?.type === 'tool_started' &&
            start.observation.callId === observation.callId &&
            start.sequence < event.sequence,
        )
      );
    return (
      observation?.type === 'tool_started' &&
      !relevant.some(
        (end) =>
          end.observation?.type === 'tool_completed' &&
          end.observation.callId === observation.callId &&
          end.sequence > event.sequence,
      )
    );
  });
}

function grade(
  grader: string,
  verdict: Grade['verdict'],
  reason: string,
  evidenceRefs: string[] = [],
): Grade {
  return { grader, version: VERSION, verdict, reason, evidenceRefs: [...new Set(evidenceRefs)] };
}

function samePath(actual: string, expected: string): boolean {
  const normalize = (path: string) => path.replaceAll('\\', '/').replace(/^\.\//, '');
  const left = normalize(actual);
  const right = normalize(expected);
  return (
    !left.split('/').includes('..') &&
    (left === right || (left.startsWith('/') && left.endsWith(`/${right}`)))
  );
}

function browserCommand(args: unknown): BrowserCommand | undefined {
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === 'string')) return;
  let index = 0;
  let session = 'default';
  while (index < args.length) {
    const arg = args[index];
    if (arg.startsWith('-s=') || arg.startsWith('--session=')) {
      session = arg.slice(arg.indexOf('=') + 1);
      index++;
    } else if (arg === '-s' || arg === '--session') {
      if (!args[index + 1]) return;
      session = args[index + 1];
      index += 2;
    } else break;
  }
  if (!args[index]) return;
  return { action: args[index], args: args.slice(index + 1), session };
}

/** The only supported shell compound: two literal native CLI invocations. */
function literalBrowserPair(
  command: unknown,
): { navigation: BrowserCommand; snapshot: BrowserCommand } | undefined {
  if (typeof command !== 'string' || /[^A-Za-z0-9_./:=+%~@& \t-]/.test(command)) return;
  const parts = command.trim().split('&&');
  if (parts.length !== 2 || parts.some((part) => part.includes('&'))) return;
  const parse = (part: string): BrowserCommand | undefined => {
    const words = part.trim().split(/[ \t]+/);
    if (words.shift() !== 'playwright-cli') return;
    let session = 'default';
    if (/^(?:-s|--session)=/.test(words[0] ?? '')) {
      const option = words.shift()!;
      session = option.slice(option.indexOf('=') + 1);
    } else if (['-s', '--session'].includes(words[0])) {
      words.shift();
      session = words.shift() ?? '';
    }
    if (!/^[A-Za-z0-9_-]+$/.test(session)) return;
    const action = words.shift();
    if (!action) return;
    return { action, args: words, session };
  };
  const navigation = parse(parts[0]);
  const snapshot = parse(parts[1]);
  if (
    !navigation ||
    !snapshot ||
    !['open', 'goto'].includes(navigation.action) ||
    navigation.args.length !== 1 ||
    snapshot.action !== 'snapshot' ||
    snapshot.args.length !== 0 ||
    navigation.session !== snapshot.session
  )
    return;
  return { navigation, snapshot };
}

function localFlow(url: unknown, evidence: TrialEvidence): boolean {
  if (typeof url !== 'string') return false;
  try {
    const requested = new URL(url);
    const local = new URL(evidence.localUrl);
    const expected = new URL(evidence.task.flowPath, local);
    return (
      ['localhost', '127.0.0.1', '[::1]'].includes(local.hostname) &&
      requested.origin === local.origin &&
      requested.pathname === expected.pathname &&
      !requested.username &&
      !requested.password
    );
  } catch {
    return false;
  }
}

function ambiguousBrowserExecution(execution: ToolExecution): boolean {
  if (execution.name !== 'bash') return false;
  const command = string(execution.args.command) ?? '';
  // Recognize possible command positions without treating a quoted echo as an
  // execution. This is only an ambiguity detector: no shell parsing can confer
  // the independent command attestation needed for a positive grade.
  const commands: string[][] = [[]];
  let token = '';
  let quote: "'" | '"' | undefined;
  let substitution = false;
  const flush = () => {
    if (token) {
      commands.at(-1)!.push(token);
      token = '';
    }
  };
  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    if (char === '\\' && quote !== "'") {
      token += command[++index] ?? '';
      continue;
    }
    if (quote) {
      if (char === quote) quote = undefined;
      else {
        if (quote === '"' && (char === '`' || (char === '$' && command[index + 1] === '(')))
          substitution = true;
        token += char;
      }
    } else if (char === "'" || char === '"') quote = char;
    else if (char === '#' && !token) {
      while (index < command.length && command[index] !== '\n') index++;
      flush();
      commands.push([]);
    } else if (/[;&|\n()]/.test(char)) {
      flush();
      commands.push([]);
    } else if (/\s/.test(char)) flush();
    else {
      if (char === '`' || (char === '$' && command[index + 1] === '(')) substitution = true;
      token += char;
    }
  }
  flush();
  if (substitution && command.includes('playwright-cli')) return true;
  return commands.some((words) => {
    while (
      words[0] &&
      (/^[A-Za-z_]\w*=/.test(words[0]) ||
        ['then', 'do', 'if', '!', 'command', 'env'].includes(words[0]))
    )
      words.shift();
    const executable = words[0]?.split('/').at(-1);
    return (
      executable === 'playwright-cli' ||
      (executable === 'npx' && words.slice(1).includes('playwright-cli')) ||
      (executable === 'pnpm' && words[1] === 'exec' && words.slice(2).includes('playwright-cli')) ||
      (['bash', 'sh', 'zsh', 'eval'].includes(executable ?? '') &&
        words.slice(1).some((word) => word.includes('playwright-cli')))
    );
  });
}

function gradeLiteralBrowserPair(
  evidence: TrialEvidence,
  tool: ToolExecution,
  mutation: ToolExecution | undefined,
): Grade | undefined {
  const receipt = tool.receipt;
  const pair = literalBrowserPair(tool.args.command);
  if (
    tool.name !== 'bash' ||
    receipt.kind !== 'bash' ||
    !tool.success ||
    receipt.exitCode !== 0 ||
    !pair ||
    !mutation ||
    tool.start.sequence <= mutation.end.sequence ||
    !localFlow(pair.navigation.args[0], evidence)
  )
    return;
  // The sandbox's immutable PATH shim and clean bash environment guarantee these
  // two literal commands invoke the installed CLI. Successful && proves both
  // exited zero. Other shell syntax never receives this treatment.
  const output = receipt.browser;
  if (output.hasError) return;
  if (output.pageUrls.length !== 2 || output.pageUrls.some((url) => !localFlow(url, evidence)))
    return;
  const file = output.linkedSnapshotPaths[0];
  const inline = output.finalInlineSnapshot;
  if (!file || !inline || !inline.includes(evidence.task.expectedText)) return;
  // The exact successful second command's inline YAML is itself captured
  // evidence in the immutable native tool result. Agent cleanup may remove the
  // workspace file later. If the file remains, require an exact match; a
  // conflicting file is uncertainty, never permission to ignore it. The first
  // command's automatic snapshot alone is insufficient in either case.
  const snapshot = evidence.artifacts.find((item) => item.path === file);
  if (snapshot && (snapshot.content !== inline || !/^[a-f0-9]{64}$/.test(snapshot.sha256))) return;
  const target = evidence.artifacts.find((item) => samePath(item.path, evidence.task.targetFile));
  if (
    !target ||
    target.sha256 !== targetFingerprint(mutation).targetAfterHash ||
    target.sha256 !== receipt.targetBeforeHash ||
    target.sha256 !== receipt.targetAfterHash
  )
    return;
  return grade(
    'browser-behavior',
    'pass',
    `The agent successfully ran the supported literal playwright-cli navigation && snapshot pair after the final change. Both reported URLs match the local flow, explicit snapshot YAML is preserved in the trusted tool result${snapshot ? ' and matches the captured file' : ''}, and the final target hash matches the validated change.`,
    [mutation.end.id, tool.start.id, tool.end.id, ...(snapshot ? [snapshot.id] : []), target.id],
  );
}

/** Observes browser behavior independently of whether the instruction is enabled. */
export function gradeBrowserBehavior(evidence: TrialEvidence): Grade {
  const name = 'browser-behavior';
  if (evidence.task.kind === 'docs')
    return grade(
      name,
      'not-applicable',
      'The task only changes documentation; browser use is optional.',
    );
  const tools = executions(evidence);
  const mutations = tools.filter((tool) => {
    const receipt = targetFingerprint(tool);
    return (
      typeof receipt.targetBeforeHash === 'string' &&
      typeof receipt.targetAfterHash === 'string' &&
      receipt.targetBeforeHash !== receipt.targetAfterHash
    );
  });
  const lastMutation = mutations.at(-1);
  const refs: string[] = lastMutation ? [lastMutation.end.id] : [];
  const sessions = new Map<string, { sequence: number; ref: string }>();
  let ambiguity =
    incompleteToolEvidence(evidence) ||
    tools.some((tool) => ambiguousBrowserExecution(tool) && tool.receipt.kind !== 'playwright-cli');
  let observedSnapshot = false;
  for (const tool of tools) {
    const receipt = tool.receipt;
    if (receipt.kind !== 'playwright-cli') {
      const literalPairGrade = gradeLiteralBrowserPair(evidence, tool, lastMutation);
      if (literalPairGrade) return literalPairGrade;
      if (ambiguousBrowserExecution(tool)) sessions.clear();
      continue;
    }
    const command = browserCommand(receipt.args);
    if (!command) {
      ambiguity = true;
      continue;
    }
    refs.push(tool.end.id);
    if (!tool.success || receipt.exitCode !== 0) {
      // A failed navigation may leave the browser at an unknown location.
      if (['open', 'goto', 'close'].includes(command.action)) sessions.delete(command.session);
      continue;
    }
    if (['open', 'goto'].includes(command.action)) {
      sessions.delete(command.session);
      const reportedUrl = receipt.browser.pageUrls[0];
      if (
        localFlow(command.args[0], evidence) &&
        (!reportedUrl || localFlow(reportedUrl, evidence))
      ) {
        sessions.set(command.session, { sequence: tool.end.sequence, ref: tool.end.id });
      }
      continue;
    }
    // Intervening actions can navigate. Require a fresh explicit local navigation
    // unless the command is known to leave the page and session alone.
    if (!['snapshot', 'screenshot', 'console', 'network'].includes(command.action)) {
      sessions.delete(command.session);
      continue;
    }
    if (command.action !== 'snapshot') continue;
    observedSnapshot = true;
    const navigation = sessions.get(command.session);
    if (
      !lastMutation ||
      tool.start.sequence <= lastMutation.end.sequence ||
      !navigation ||
      tool.start.sequence <= navigation.sequence
    )
      continue;
    const snapshotUrl = receipt.browser.pageUrls[0];
    if (!snapshotUrl) {
      ambiguity = true;
      continue;
    }
    if (!localFlow(snapshotUrl, evidence)) continue;
    const snapshot = receipt.snapshot;
    if (!snapshot) {
      ambiguity = true;
      continue;
    }
    const { path, content, sha256: hash } = snapshot;
    const artifact = evidence.artifacts.find(
      (item) => item.path === path && item.sha256 === hash && item.content === content,
    );
    if (!artifact) {
      ambiguity = true;
      continue;
    }
    if (!content.includes(evidence.task.expectedText)) continue;
    const target = evidence.artifacts.find((item) => samePath(item.path, evidence.task.targetFile));
    if (
      !target ||
      target.sha256 !== targetFingerprint(lastMutation!).targetAfterHash ||
      target.sha256 !== receipt.targetAfterHash
    ) {
      ambiguity = true;
      continue;
    }
    return grade(
      name,
      'pass',
      'The agent captured a matching playwright-cli snapshot after the final target modification, in the same session as a successful local flow navigation. The snapshot URL and final target hash match the validated change.',
      [lastMutation.end.id, navigation.ref, tool.end.id, artifact.id, target.id],
    );
  }
  if (evidence.agent.status !== 'completed') {
    return grade(
      name,
      'unknown',
      `The trial ended with ${evidence.agent.status}; missing browser evidence is inconclusive.`,
      refs,
    );
  }
  if (!lastMutation) {
    return grade(
      name,
      'unknown',
      'No trustworthy target mutation ordering was captured; browser validation after the change cannot be established.',
      refs,
    );
  }
  if (ambiguity)
    return grade(
      name,
      'unknown',
      'Browser commands or snapshot provenance were not fully attested; shell text and self-reports cannot establish compliance.',
      refs,
    );
  return grade(
    name,
    'fail',
    observedSnapshot
      ? 'No successful snapshot proved the changed flow after the final modification and matching local navigation.'
      : 'The completed trial did not capture a successful playwright-cli snapshot for the changed local flow.',
    refs,
  );
}

export function gradeBrowserCompliance(evidence: TrialEvidence): Grade {
  if (evidence.task.kind === 'docs')
    return grade(
      'browser-compliance',
      'not-applicable',
      'The instruction does not apply to a documentation-only task.',
    );
  if (evidence.variant === 'disabled')
    return grade(
      'browser-compliance',
      'not-applicable',
      'This trial removes the instruction. Browser behavior is graded separately for comparison.',
    );
  return { ...gradeBrowserBehavior(evidence), grader: 'browser-compliance' };
}

/** Mechanical target-content check, deliberately separate from semantic quality. */
export function gradeOutcome(evidence: TrialEvidence): Grade {
  const observation = events(evidence)
    .filter(
      (event) =>
        event.actor !== 'agent' &&
        event.kind === 'lifecycle' &&
        event.data.type === 'trial_observation' &&
        typeof event.data.targetFile === 'string' &&
        samePath(event.data.targetFile, evidence.task.targetFile),
    )
    .at(-1);
  const artifact = evidence.artifacts.find((item) => samePath(item.path, evidence.task.targetFile));
  const content = string(observation?.data.targetAfterContent) ?? artifact?.content;
  const ref = observation?.id ?? artifact?.id;
  if (content === undefined)
    return grade(
      'target-outcome',
      'unknown',
      'The evaluator did not capture the final target file.',
    );
  if (content.includes(evidence.task.expectedText)) {
    return grade(
      'target-outcome',
      'pass',
      'The evaluator-observed target contains the expected task text; semantic quality is graded separately.',
      ref ? [ref] : [],
    );
  }
  return grade(
    'target-outcome',
    evidence.agent.status === 'completed' ? 'fail' : 'unknown',
    evidence.agent.status === 'completed'
      ? 'The final target is missing the expected task text.'
      : `The trial ended with ${evidence.agent.status} before the expected target outcome was observed.`,
    ref ? [ref] : [],
  );
}

function simpleCat(command: string): string | undefined {
  // Intentionally excludes expansions, redirections, functions, and shell chains.
  const match = /^\s*cat\s+(?:--\s+)?(?:'([^']+)'|"([^"$`\\]+)"|([^\s;&|<>$`\\]+))\s*$/.exec(
    command,
  );
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

export function observeSkills(evidence: TrialEvidence): SkillObservation[] {
  const observations = new Map<string, SkillObservation>();
  for (const event of events(evidence)) {
    if (
      event.actor === 'agent' ||
      event.kind !== 'lifecycle' ||
      event.data.type !== 'skill_inventory' ||
      !Array.isArray(event.data.skills)
    )
      continue;
    for (const item of event.data.skills) {
      const skill = record(item);
      const path = string(skill.path);
      if (!path) continue;
      observations.set(path, {
        path,
        available: skill.available === true ? 'yes' : skill.available === false ? 'no' : 'unknown',
        discovered:
          skill.discovered === true ? 'yes' : skill.discovered === false ? 'no' : 'unknown',
        ...(typeof skill.sha256 === 'string' ? { sha256: skill.sha256 } : {}),
        loaded: 'unknown',
        evidenceRefs: [event.id],
      });
    }
  }
  for (const tool of executions(evidence)) {
    if (!tool.success || !tool.text.trim()) continue;
    const path =
      tool.name === 'read'
        ? string(tool.args.path)
        : tool.name === 'bash'
          ? simpleCat(string(tool.args.command) ?? '')
          : undefined;
    if (!path || !/(?:^|\/)SKILL\.md$/.test(path)) continue;
    const existing = [...observations.values()].find((item) => samePath(path, item.path));
    const value: SkillObservation = existing ?? {
      path,
      available: 'unknown',
      discovered: 'unknown',
      loaded: 'unknown',
      evidenceRefs: [],
    };
    const matchesInventory =
      value.sha256 !== undefined &&
      /^[a-f0-9]{64}$/.test(value.sha256) &&
      tool.textSha256 === value.sha256 &&
      !tool.truncated;
    const completeRead =
      tool.name === 'read' &&
      (tool.args.offset === undefined || tool.args.offset === 1) &&
      tool.receipt.kind === 'file-read' &&
      tool.receipt.sha256 === value.sha256;
    const completeCat =
      tool.name === 'bash' && tool.receipt.kind === 'bash' && tool.receipt.exitCode === 0;
    // The boundary's file hash alone proves the source version, not how much of
    // it reached the agent. Exact output equality also rules out read windows,
    // truncation and changed skill files. Uninventoried files stay unknown.
    if (matchesInventory && (completeRead || completeCat)) value.loaded = 'yes';
    value.evidenceRefs.push(tool.end.id);
    observations.set(value.path, value);
  }
  return [...observations.values()];
}

export function gradeTrial(evidence: TrialEvidence): Grade[] {
  return [gradeOutcome(evidence), gradeBrowserCompliance(evidence), gradeBrowserBehavior(evidence)];
}
