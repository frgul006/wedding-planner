import type { ComparisonResult } from './comparison.ts';
import type { Grade, GradingResult, TrialEvidence, Usage } from './types.ts';

export { compareTrials, type ComparableTrial } from './comparison.ts';

export interface SemanticReport {
  status: string;
  usage: Pick<Usage, 'estimatedCostUsd'> & Partial<Usage>;
  model: string;
  grade?: Grade;
}

/** Report identity is distinct from the saved trial, especially during regrading. */
export interface ReportContext {
  gradingResults?: readonly GradingResult[];
  trialId?: string;
  regrade?: {
    id?: string;
    regradedAt?: string;
    harnessHash?: string;
    sourceIntegrityHash?: string;
  };
  availableFiles?: readonly string[];
}

function inline(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\\', '\\\\')
    .replaceAll(/([`*_[\]#|])/g, '\\$1')
    .replaceAll(/\r?\n/g, ' ');
}

function cost(usd: number | null | undefined): string {
  return typeof usd === 'number' && Number.isFinite(usd)
    ? `$${usd.toFixed(6)} (application estimate)`
    : 'unknown';
}

function tokens(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('en-US')
    : 'unknown';
}

function tokenSummary(usage: Partial<Usage>, includeCacheWrite = false): string {
  // Historical records use zero placeholders when no usage response arrived.
  // A null dollar estimate alone does not mean the observed tokens are missing.
  const unavailable = /^Unknown: (?:no successful usage response|agent did not return usage)/.test(
    usage.costSource ?? '',
  );
  const observed = (value: number | undefined) => (unavailable ? 'unknown' : tokens(value));
  return `${observed(usage.inputTokens)} input, ${observed(usage.outputTokens)} output, ${observed(usage.cacheReadTokens)} cache read${includeCacheWrite ? `, ${observed(usage.cacheWriteTokens)} cache write` : ''}`;
}

function duration(start: string, end: string): string {
  const elapsed = Date.parse(end) - Date.parse(start);
  if (!Number.isFinite(elapsed) || elapsed < 0) return 'unknown';
  const seconds = elapsed / 1000;
  return seconds < 60
    ? `${seconds.toFixed(1)} seconds`
    : `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(1)}s`;
}

function modelName(model: TrialEvidence['agent']['model']): string {
  if (!model || typeof model.id !== 'string') return 'unknown';
  return typeof model.provider === 'string' ? `${model.provider}/${model.id}` : model.id;
}

function problems(evidence: TrialEvidence, semantic?: SemanticReport): string[] {
  const messages = new Set<string>();
  const statusLabels = {
    infrastructure_error: 'Infrastructure',
    agent_error: 'Agent',
    budget_exceeded: 'Budget',
    timeout: 'Deadline',
    completed: 'Agent',
    cancelled: 'User cancellation',
  };
  if (evidence.agent.error)
    messages.add(`${statusLabels[evidence.agent.status]}: ${evidence.agent.error}`);
  const lifecycleLabels: Record<string, string> = {
    infrastructure_error: 'Infrastructure',
    cleanup_error: 'Cleanup',
    artifact_collection_error: 'Artifact collection',
    grader_error: 'Deterministic grader',
    grader_cancelled: 'Grading cancellation',
  };
  for (const event of evidence.events) {
    if (event.actor === 'agent' || event.kind !== 'lifecycle') continue;
    const label = lifecycleLabels[String(event.data.type)];
    const message = event.data.message;
    if (label && typeof message === 'string' && message !== evidence.agent.error)
      messages.add(`${label}: ${message}`);
  }
  if (semantic?.status === 'grader_error' || semantic?.status === 'cancelled')
    messages.add(
      `Semantic grader: ${semantic.grade?.reason ?? 'The grader failed; inspect semantic.json for the recorded cause.'}`,
    );
  if (evidence.agent.status !== 'completed' && !messages.size)
    messages.add(`Trial ended with ${evidence.agent.status}; no error detail was recorded.`);
  return [...messages];
}

function gradeTable(grades: readonly Grade[]): string {
  return [
    '| Grader | Verdict | Reason | Evidence |',
    '| --- | --- | --- | --- |',
    ...grades.map(
      (grade) =>
        `| ${inline(grade.grader)} v${inline(grade.version)} | **${inline(grade.verdict)}** | ${inline(grade.reason)} | ${[...new Set(grade.evidenceRefs)].map(inline).join(', ') || 'none'} |`,
    ),
  ].join('\n');
}

function evidenceLinks(files: readonly string[]): string {
  return files
    .filter((file) => /^[\w.-]+$/.test(file))
    .map((file) => `[${file}](${file})`)
    .join(' · ');
}

export function renderReport(
  id: string,
  evidence: TrialEvidence,
  grades: Grade[],
  semantic?: SemanticReport,
  context: ReportContext = {},
): string {
  const trialId = context.trialId ?? id;
  const controls = evidence.events.find(
    (event) =>
      event.actor === 'evaluator' && event.kind === 'lifecycle' && event.data.type === 'pi_started',
  );
  const agent = evidence.agent;
  const sections = [
    `# ${context.regrade ? 'Regrade' : 'Agent evaluation'}: ${inline(context.regrade?.id ?? id)}`,
    `Trial: **${inline(trialId)}**

Task: **${inline(evidence.task.id)}@${inline(evidence.task.version)}** · instruction **${evidence.variant}**

Trial status: **${agent.status}** · duration: ${duration(agent.startedAt, agent.endedAt)}

Model: **${inline(modelName(agent.model))}** · reasoning: **${inline(agent.thinkingLevel ?? 'unknown')}**`,
  ];
  if (context.regrade) {
    sections.push(
      `These judgments use the saved trial evidence. Pi was not rerun; the original trial status and report remain unchanged.${context.regrade.regradedAt ? ` Regraded at ${inline(context.regrade.regradedAt)}.` : ''}`,
    );
  }
  const errors = problems(evidence, semantic);
  if (errors.length)
    sections.push(`## What needs attention

${errors.map((error) => `- ${inline(error)}`).join('\n')}`);
  sections.push(`## Judgments

${grades.length ? gradeTable(grades) : 'No judgments were recorded.'}`);

  const usage = agent.usage;
  const agentTokens = `Agent tokens: ${tokenSummary(usage, true)}.`;
  const agentCost =
    controls?.data.agentCostLimitEnabled === false
      ? `Pi’s dollar threshold was disabled; tokens and runtime remained bounded. Catalog price estimate: ${cost(usage.estimatedCostUsd)}, retained for audit only.`
      : `Agent cost: ${cost(usage.estimatedCostUsd)}. ${inline(usage.costSource)}.`;
  const modelResults = context.gradingResults?.filter(
    (result) => result.metering === 'semantic-api' || result.usage,
  );
  const graderUsage = modelResults?.length
    ? modelResults
        .map(
          (result) =>
            `Grader API: **${inline(result.grader)}** · ${inline(result.criteria?.model ?? 'unknown model')} · ${inline(result.status)} · ${cost(result.usage?.estimatedCostUsd)}.\n\nGrader tokens: ${tokenSummary(result.usage ?? {})}.`,
        )
        .join('\n\n')
    : semantic
      ? `Grader API: **${inline(semantic.model)}** · ${inline(semantic.status)} · ${cost(semantic.usage.estimatedCostUsd)}.

Grader tokens: ${tokenSummary(semantic.usage)}.`
      : context.regrade
        ? 'Grader API: not run for this regrade (no new API cost). Any earlier semantic judgment remains in the original report; it is not a judgment from this regrade.'
        : 'Grader API: not run (no API cost).';
  sections.push(`## Usage and cost

${agentTokens}

${agentCost}

${graderUsage}

The manifest or regrade JSON records the API allowance and which calls it covers. Missing costs remain unknown. Usage checks can overshoot during an in-flight response; application estimates are not provider spending caps.`);

  const files = context.availableFiles ?? [
    'manifest.json',
    'evidence.json',
    'transcript.jsonl',
    'grades.json',
    'skills.json',
    ...(controls ? ['environment.json'] : []),
    ...(semantic ? ['semantic.json'] : []),
  ];
  const provenance = context.regrade
    ? [
        context.regrade.harnessHash && `Grading harness: ${inline(context.regrade.harnessHash)}.`,
        context.regrade.sourceIntegrityHash &&
          `Source integrity manifest: ${inline(context.regrade.sourceIntegrityHash)}.`,
      ]
        .filter(Boolean)
        .join('\n\n')
    : '';
  sections.push(`## Saved evidence

${evidenceLinks(files)}${context.regrade ? '\n\n[Original trial report](report.md)' : ''}${
    provenance
      ? `

${provenance}`
      : ''
  }

The manifest records versions, model settings, budget and attempts. Evidence and transcripts retain attributed observations; evaluator actions do not earn agent compliance.`);
  sections.push(
    `This is one trial of ${evidence.task.environment === 'repository' ? 'a pinned repository revision' : 'a synthetic fixture'}. It establishes neither reliable compliance nor whether the instruction is needed. Semantic judgments remain provisional until a person reviews the calibration cases.`,
  );
  return `${sections.join('\n\n')}
`;
}

export interface ComparisonObservation {
  id: string;
  variant: string;
  status?: string;
  reportPath?: string;
  grades: readonly Grade[];
  grading?: { label: string; harnessHash?: string; gradedAt?: string };
}

/** Render explicitly selected judgments; callers decide which grading revision to use. */
export function renderComparisonReport(
  id: string,
  result: ComparisonResult,
  observations: readonly ComparisonObservation[],
): string {
  const sections = [
    `# Trial comparison: ${inline(id)}`,
    `Controlled comparison: **${result.eligible ? 'eligible' : 'ineligible'}**

${inline(result.reason)}`,
  ];
  if (result.mismatches.length) {
    const display = (value: unknown) =>
      value === undefined ? 'missing' : inline(JSON.stringify(value).slice(0, 240));
    sections.push(`## Conditions that differ

| Invariant | First trial | Second trial |
| --- | --- | --- |
${result.mismatches.map((mismatch) => `| ${inline(mismatch.path)} | ${display(mismatch.left)} | ${display(mismatch.right)} |`).join('\n')}`);
  }
  for (const observation of observations) {
    const link = observation.reportPath
      ? `

[Saved report](<${observation.reportPath.replaceAll(/[<>\r\n]/g, '')}>)`
      : '';
    const revision = observation.grading
      ? `${inline(observation.grading.label)}${observation.grading.gradedAt ? ` (${inline(observation.grading.gradedAt)})` : ''}${observation.grading.harnessHash ? `; harness ${inline(observation.grading.harnessHash)}` : ''}`
      : 'Original saved judgments';
    sections.push(`## Instruction ${inline(observation.variant)}

Trial: **${inline(observation.id)}** · status: **${inline(observation.status ?? 'unknown')}**

Grading revision: ${revision}${link}

${observation.grades.length ? gradeTable(observation.grades) : 'No judgments were recorded.'}`);
  }
  sections.push(
    'These are individual observations, including failures and unknowns. Repeat matched trials before estimating an instruction’s effect; successful disabled runs alone do not establish that an instruction is unnecessary.',
  );
  return `${sections.join('\n\n')}
`;
}
