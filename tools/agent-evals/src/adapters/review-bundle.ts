import type { Grade, GradingResult, TrialEvidence, Usage } from '../domain/types.ts';
import { FileRunStore, hash } from './file-run-store.ts';
import { redact } from './secrets.ts';

export interface ReviewTrial {
  id: string;
  evidence: TrialEvidence;
  grades: Grade[];
  gradingResults: GradingResult[];
  integrityHash: string;
}
const identifier = (value: unknown) =>
  typeof value === 'string' && /^[a-zA-Z0-9._:-]{1,150}$/.test(value)
    ? redact(value).replaceAll(/\[REDACTED[^\]]*\]/g, 'redacted')
    : 'unknown';
const digest = (value: unknown) =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null;
const count = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const usageView = (usage: Usage) => {
  const unavailable = /^Unknown: (?:no successful usage response|agent did not return usage)/.test(
    usage.costSource,
  );
  const tokens = (value: unknown) => (unavailable ? null : count(value));
  return {
    inputTokens: tokens(usage.inputTokens),
    outputTokens: tokens(usage.outputTokens),
    cacheReadTokens: tokens(usage.cacheReadTokens),
    cacheWriteTokens: tokens(usage.cacheWriteTokens),
    estimatedCostUsd: count(usage.estimatedCostUsd),
  };
};

/** Do not export arbitrary strings: tool/model text can contain private instructions or credentials. */
export function reviewTrial(trial: ReviewTrial) {
  const { evidence } = trial;
  return {
    id: identifier(trial.id),
    task: identifier(evidence.task.id),
    variant: evidence.variant,
    status: evidence.agent.status,
    model: {
      provider: identifier(evidence.agent.model?.provider),
      id: identifier(evidence.agent.model?.id),
    },
    reasoning: identifier(evidence.agent.thinkingLevel),
    originalIntegrityHash: digest(trial.integrityHash),
    agentUsage: usageView(evidence.agent.usage),
    graderUsage: trial.gradingResults
      .filter((result) => result.usage)
      .map((result) => ({
        grader: identifier(result.grader),
        status: result.status,
        usage: usageView(result.usage!),
      })),
    grades: trial.grades.map((grade) => ({
      grader: identifier(grade.grader),
      version: identifier(grade.version),
      verdict: grade.verdict,
      evidenceRefs: grade.evidenceRefs.map(identifier),
    })),
    artifacts: evidence.artifacts.map((artifact) => ({
      id: identifier(artifact.id),
      sha256: digest(artifact.sha256),
      bytes: Buffer.byteLength(artifact.content),
    })),
    toolObservations: evidence.events.flatMap((event) => {
      const observation = event.observation;
      if (observation?.type !== 'tool_completed') return [];
      const receipt = observation.receipt;
      return [
        {
          id: identifier(event.id),
          actor: event.actor,
          success: observation.success,
          receipt: receipt.kind,
          truncated: observation.truncated,
          targetBeforeHash: 'targetBeforeHash' in receipt ? digest(receipt.targetBeforeHash) : null,
          targetAfterHash: 'targetAfterHash' in receipt ? digest(receipt.targetAfterHash) : null,
          exitCode: 'exitCode' in receipt ? receipt.exitCode : null,
          snapshotHash: receipt.kind === 'playwright-cli' ? digest(receipt.snapshot?.sha256) : null,
        },
      ];
    }),
  };
}
export interface ReviewComparison {
  pair: number;
  eligible: boolean;
  mismatchFields: string[];
}
export function buildReviewBundle(
  id: string,
  trials: ReviewTrial[],
  comparisons: ReviewComparison[],
  budget: { limitUsd: number; reservedEstimateUsd: number; observedApiEstimateUsd?: number | null },
  incompleteAttempts: number,
) {
  return {
    schemaVersion: 1,
    id: identifier(id),
    scope:
      'Allowlisted review summary. Raw prompts, instructions, paths, tool output, artifact contents and free-form reasons remain private. This bundle is not a replayable transcript.',
    budget: {
      limitUsd: count(budget.limitUsd),
      reservedEstimateUsd: count(budget.reservedEstimateUsd),
      observedApiEstimateUsd: count(budget.observedApiEstimateUsd),
    },
    incompleteAttempts,
    comparisons: comparisons.map((pair) => ({
      pair: pair.pair,
      eligible: pair.eligible,
      mismatchFields: pair.mismatchFields.map(identifier),
    })),
    trials: trials.map(reviewTrial),
  };
}
export function renderReviewBundle(bundle: ReturnType<typeof buildReviewBundle>): string {
  const rows = bundle.trials.flatMap((trial) =>
    trial.grades.map(
      (grade) =>
        `| ${trial.id} | ${trial.variant} | ${trial.status} | ${grade.grader} | ${grade.verdict} |`,
    ),
  );
  return `# Experiment ${bundle.id}

${bundle.scope}

API allowance: $${bundle.budget.limitUsd}; reserved estimate: $${bundle.budget.reservedEstimateUsd?.toFixed(6) ?? 'unknown'}.
Observed direct API estimate: ${bundle.budget.observedApiEstimateUsd === null ? 'unknown' : `$${bundle.budget.observedApiEstimateUsd.toFixed(6)}`} (subscription catalog estimates excluded).
Trials retained: ${bundle.trials.length}; attempts without a completed saved trial: ${bundle.incompleteAttempts}.
Matched pairs: ${bundle.comparisons.filter((pair) => pair.eligible).length}/${bundle.comparisons.length}.

| Trial | Instruction | Execution | Grader | Verdict |
| --- | --- | --- | --- | --- |
${rows.join('\n')}

These are observations, including failures. A small number of pairs does not establish instruction usefulness.
Structured receipt facts and source-integrity hashes are in [bundle.json](bundle.json).
`;
}
export async function writeReviewBundle(
  directory: string,
  bundle: ReturnType<typeof buildReviewBundle>,
) {
  const store = new FileRunStore(directory);
  await store.initialize();
  await store.save('bundle.json', bundle);
  await store.save('report.md', renderReviewBundle(bundle));
  const json = JSON.stringify(bundle);
  await store.save('bundle-fingerprint.json', {
    sha256: hash(json),
    serialization: 'JSON.stringify(bundle)',
  });
  await store.seal(['bundle.json', 'report.md', 'bundle-fingerprint.json']);
}
