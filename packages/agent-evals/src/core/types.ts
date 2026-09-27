import type { TrialLimits } from './trial-limits.ts';

export type { TrialLimits } from './trial-limits.ts';

/** Portable authoring contracts. Vendor payloads belong in metadata, never in core rules. */

export type Verdict = 'pass' | 'fail' | 'unknown' | 'not_applicable';

export type Version = string | number;

export interface TraceEvent {
  id: string;
  sequence: number;
  timestamp: string;
  actor: 'agent' | 'environment' | 'evaluator';
  type: 'message' | 'tool-call' | 'tool-result' | 'lifecycle';
  data: Record<string, unknown>;
  source?: Record<string, unknown>;
}

export interface TraceArtifact {
  id: string;
  path: string;
  content: string;
  sha256: string;
}

export interface RecordedTrial {
  id: string;
  task: { id: string; version: Version; prompt: string; metadata?: Record<string, unknown> };
  status: string;
  trace: {
    events: TraceEvent[];
    artifacts: TraceArtifact[];
    contexts: Array<TraceArtifact & { kind: string }>;
    complete: boolean;
    gaps: string[];
  };
  outcome: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface PreparedItem<T = unknown> {
  id: string;
  data: T;
  scope: string;
  sourceRefs: string[];
  coverage: { complete: boolean; gaps: string[] };
  omissions: string[];
  applicability: 'applicable' | 'not_applicable' | 'unknown';
}

export interface View<T = unknown> {
  id: string;
  version: Version;
  prepare(trial: RecordedTrial): PreparedItem<T>[] | Promise<PreparedItem<T>[]>;
}

export interface CheckResult {
  verdict: Verdict;
  reason?: string;
  /** Only explicitly supporting references; considered evidence is recorded separately. */
  supportingRefs?: string[];
}

interface GraderBase<T> {
  id: string;
  version: Version;
  view: View<T>;
  aggregate?: {
    rule: string;
    combine(items: readonly { grade: Grade; evidence: PreparedEvidence<T> }[]): Verdict;
  };
}

export interface CodeGrader<T = unknown> extends GraderBase<T> {
  kind: 'code';
  check(item: PreparedItem<T>, trial: RecordedTrial): CheckResult | Promise<CheckResult>;
}

export interface ModelGrader<T = unknown> extends GraderBase<T> {
  kind: 'model';
  question: string;
  rubric: Record<'pass' | 'fail' | 'unknown', string> & Partial<Record<'not_applicable', string>>;
}

export type Grader<T = unknown> = CodeGrader<T> | ModelGrader<T>;

export interface PreparedEvidence<T = unknown> extends PreparedItem<T> {
  view: { id: string; version: Version };
  serializationVersion: 'canonical-json-v1';
  contentHash: string;
}

export interface JudgmentJob {
  id: string;
  grader: { id: string; version: Version };
  evidence: PreparedEvidence;
  question: string;
  rubric: ModelGrader['rubric'];
}

export interface JudgeRequest {
  id: string;
  jobIds: string[];
  /** Exact credential-free provider body, persisted before dispatch. */
  body: Record<string, unknown>;
  metadata: Record<string, unknown>;
  reservedCostUsd: number;
}

export interface JudgeResponse {
  answers: Array<{ jobId: string; verdict: Verdict; metadata?: Record<string, unknown> }>;
  raw: unknown;
  model: string;
  usage: { inputTokens: number; outputTokens: number; estimatedCostUsd: number | null };
}

export interface Judge {
  id: string;
  prepare(jobs: readonly JudgmentJob[]): Promise<JudgeRequest[]>;
  execute(request: JudgeRequest, signal?: AbortSignal): Promise<JudgeResponse>;
}

export interface Grade extends CheckResult {
  grader: { id: string; version: Version };
  evidenceId: string;
  consideredRefs: string[];
  status: 'completed' | 'preparation_error' | 'grader_error' | 'cancelled';
  metadata?: Record<string, unknown>;
}

export interface GradingRecord {
  id: string;
  trialId: string;
  trialHash: string;
  createdAt: string;
  evidence: PreparedEvidence[];
  jobs: JudgmentJob[];
  requests: Array<{
    request: JudgeRequest;
    dispatched: boolean;
    response?: JudgeResponse;
    /** Credential-free fallback data when the response could not produce valid grades. */
    receivedResponse?: unknown;
    /** Usage from an invalid response; valid responses carry their own usage. */
    observedUsage?: JudgeResponse['usage'];
    error?: string;
  }>;
  grades: Grade[];
  rollups: Array<{
    grader: string;
    verdict: Verdict;
    counts: Record<Verdict, number>;
    rule: string;
    /** Present when the consumer's aggregation callback failed. */
    status?: 'aggregation_error';
    reason?: string;
  }>;
}

export interface EvaluationTask {
  id: string;
  version: Version;
  prompt: string;
  limits?: Partial<TrialLimits>;
  metadata?: Record<string, unknown>;
}

export interface Runner {
  run(
    task: EvaluationTask,
    options: { trialId: string; signal?: AbortSignal; limits?: Partial<TrialLimits> },
  ): Promise<RecordedTrial>;
}

export interface Suite {
  id: string;
  tasks: EvaluationTask[];
  graders: Grader[];
}

export interface SuiteRun {
  id: string;
  suiteId: string;
  trialIds: string[];
  gradingIds: string[];
}

export interface Store {
  saveTrial(trial: RecordedTrial): Promise<void>;
  loadTrial(id: string): Promise<RecordedTrial>;
  saveRun(run: SuiteRun): Promise<void>;
  loadRun(id: string): Promise<SuiteRun>;
  /** Append-only final grading records. */
  saveGrading(record: GradingRecord): Promise<void>;
  /** Append a credential-free request before any provider dispatch. */
  saveRequest(gradingId: string, request: JudgeRequest): Promise<void>;
  /** Final grading records only; interrupted request journals are retained separately. */
  listGradings(trialId: string): Promise<GradingRecord[]>;
}
