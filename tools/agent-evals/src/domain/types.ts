/** Agent Evaluation bounded context. These contracts have no runtime dependencies. */
export type Verdict = 'pass' | 'fail' | 'unknown' | 'not-applicable';
export type Actor = 'agent' | 'environment' | 'evaluator';
export type TrialStatus =
  | 'completed'
  | 'cancelled'
  | 'timeout'
  | 'budget_exceeded'
  | 'infrastructure_error'
  | 'agent_error';

/** Verified fields from the tool boundary, independent of its native JSON shape. */
export interface TargetFingerprint {
  targetBeforeHash?: string;
  targetAfterHash?: string;
}

export interface SnapshotReceipt {
  source: 'file' | 'tool-output';
  path: string;
  content: string;
  sha256: string;
}

/** Browser facts decoded by an adapter; graders do not parse CLI output formats. */
export interface BrowserOutput {
  pageUrls: string[];
  linkedSnapshotPaths: string[];
  finalInlineSnapshot?: string;
  hasError: boolean;
}

export type ToolReceipt =
  | { kind: 'unknown'; reason: 'missing' | 'unsupported' | 'malformed' }
  | (TargetFingerprint & { kind: 'file-read'; path: string; sha256: string })
  | (TargetFingerprint & { kind: 'file-edit' | 'file-write'; path: string })
  | (TargetFingerprint & { kind: 'bash'; exitCode: number; browser: BrowserOutput })
  | (TargetFingerprint & {
      kind: 'playwright-cli';
      args: string[];
      exitCode: number;
      browser: BrowserOutput;
      snapshot?: SnapshotReceipt;
    });

/** Adapter-produced facts; raw provider messages remain available for audit. */
export type EvaluationObservation =
  | { type: 'tool_started'; callId: string; name: string; args: Record<string, unknown> }
  | {
      type: 'tool_completed';
      callId: string;
      success: boolean | 'unknown';
      text: string;
      textSha256: string;
      truncated: boolean;
      receipt: ToolReceipt;
    }
  | { type: 'skills_discovered'; skills: Array<{ path: string; name?: string }> };
export interface EvidenceEvent {
  id: string;
  sequence: number;
  timestamp: string;
  actor: Actor;
  kind: 'pi' | 'command' | 'lifecycle';
  data: Record<string, unknown>;
  observation?: EvaluationObservation;
}
export interface Artifact {
  id: string;
  path: string;
  sha256: string;
  content: string;
  observedBy: 'evaluator';
}
export interface Task {
  id: string;
  version: string;
  kind: 'ui' | 'docs';
  prompt: string;
  targetFile: string;
  expectedText: string;
  flowPath: string;
}
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  estimatedCostUsd: number | null;
  costSource: string;
}
export interface AgentResult {
  status: TrialStatus;
  startedAt: string;
  endedAt: string;
  exitCode: number | null;
  signal: string | null;
  usage: Usage;
  model: Record<string, unknown> | null;
  thinkingLevel: string | null;
  events: EvidenceEvent[];
  error?: string;
}
export interface Grade {
  grader: string;
  version: string;
  verdict: Verdict;
  reason: string;
  evidenceRefs: string[];
}
export interface TrialEvidence {
  task: Task;
  variant: 'enabled' | 'disabled';
  localUrl: string;
  agent: AgentResult;
  artifacts: Artifact[];
  events: EvidenceEvent[];
}
export interface AgentRunRequest {
  signal?: AbortSignal;
  cwd: string;
  env: Record<string, string>;
  prompt: string;
  runtimeMs: number;
  maxTokens: number;
  /** Null disables dollar admission/abort controls for subscription-funded agents. */
  maxEstimatedCostUsd: number | null;
  executable?: string;
  expectedModel?: { provider: string; id: string; thinkingLevel: string };
  args?: string[];
  onEvent?: (event: EvidenceEvent) => void;
}
export interface AgentRunner {
  run(request: AgentRunRequest): Promise<AgentResult>;
}
export interface Grader {
  grade(evidence: TrialEvidence, signal?: AbortSignal): Promise<Grade[]>;
}
export interface RunStore {
  save(name: string, value: unknown): Promise<void>;
  append(event: EvidenceEvent): void;
}
export interface PreparedEnvironment {
  root: string;
  workspace: string;
  url: string;
  env: Record<string, string>;
  agentArgs: string[];
  provenance: Record<string, unknown>;
  collectArtifacts(): Promise<Artifact[]>;
  cleanup(): Promise<void>;
}
export interface TrialEnvironment {
  prepare(task: Task, variant: 'enabled' | 'disabled', id: string): Promise<PreparedEnvironment>;
}
