import type {
  CheckResult,
  Grade,
  Grader,
  GradingRecord,
  Judge,
  PreparedEvidence,
  PreparedItem,
  Store,
  View,
} from '../types.ts';
import { contentHash, immutableCopy } from '../serialization.ts';
import { gradingVerdicts, rollupGrades } from './grading-definition.ts';
import { JudgePreparationError, JudgeExecutionError, validObservedUsage } from './judge-errors.ts';

const identity = (prefix: string) => `${prefix}-${Date.now()}-${crypto.randomUUID()}`;

function validateItem(item: PreparedItem, sources: Set<string>) {
  if (
    !item.id ||
    !item.scope ||
    !Array.isArray(item.sourceRefs) ||
    item.sourceRefs.some((ref) => !sources.has(ref)) ||
    !Array.isArray(item.omissions) ||
    !item.coverage ||
    typeof item.coverage.complete !== 'boolean' ||
    !Array.isArray(item.coverage.gaps) ||
    (item.coverage.complete && item.coverage.gaps.length > 0) ||
    !['applicable', 'not_applicable', 'unknown'].includes(item.applicability)
  ) {
    throw new Error('Invalid prepared evidence or unresolved source reference');
  }
}

export function createTrialGrader(options: { store: Store; judge?: Judge }, allowance: number) {
  async function gradeTrial(
    trialId: string,
    graders: readonly Grader[],
    budget: { used: number },
    signal?: AbortSignal,
  ): Promise<GradingRecord> {
    const trial = immutableCopy(await options.store.loadTrial(trialId));
    const record: GradingRecord = {
      id: identity('grading'),
      trialId,
      trialHash: await contentHash(trial),
      createdAt: new Date().toISOString(),
      evidence: [],
      jobs: [],
      requests: [],
      grades: [],
      rollups: [],
    };
    const sources = new Set([
      ...trial.trace.events.map((event) => event.id),
      ...trial.trace.artifacts.map((artifact) => artifact.id),
      ...trial.trace.contexts.map((context) => context.id),
    ]);
    const prepared = new Map<View, PreparedEvidence[]>();

    const addGrade = (
      grader: Grader,
      evidence: PreparedEvidence,
      result: CheckResult,
      status: Grade['status'] = 'completed',
      metadata?: Record<string, unknown>,
    ) => {
      result = immutableCopy(result);
      metadata = metadata === undefined ? undefined : immutableCopy(metadata);
      if (
        !gradingVerdicts.includes(result.verdict) ||
        (result.reason !== undefined && typeof result.reason !== 'string') ||
        (result.supportingRefs !== undefined && !Array.isArray(result.supportingRefs)) ||
        result.supportingRefs?.some((ref) => !evidence.sourceRefs.includes(ref))
      ) {
        throw new Error('Invalid grade or unsupported supporting reference');
      }
      record.grades.push({
        ...result,
        grader: { id: grader.id, version: grader.version },
        evidenceId: evidence.id,
        consideredRefs: [...evidence.sourceRefs],
        status,
        metadata,
      });
    };

    for (const grader of graders) {
      if (!prepared.has(grader.view)) {
        try {
          signal?.throwIfAborted();
          const items = immutableCopy(await grader.view.prepare(trial));
          const ids = new Set<string>();
          const values: PreparedEvidence[] = [];

          for (const item of items) {
            validateItem(item, sources);
            if (ids.has(item.id)) {
              throw new Error('Duplicate view item ID');
            }
            ids.add(item.id);
            const value = {
              ...item,
              id: `e-${await contentHash([grader.view.id, grader.view.version, item.id])}`,
              view: { id: grader.view.id, version: grader.view.version },
              serializationVersion: 'canonical-json-v1' as const,
            };
            values.push(immutableCopy({ ...value, contentHash: await contentHash(value) }));
          }

          prepared.set(grader.view, values);
          record.evidence.push(...values);
        } catch {
          // View exceptions may contain captured secrets or data; retain a stable error only.
          prepared.set(grader.view, []);
        }
      }

      const items = prepared.get(grader.view)!;
      if (!items.length) {
        const reason = 'Evidence preparation failed or returned no items';
        const missing = {
          id: `e-${await contentHash([grader.view.id, grader.view.version, 'preparation-error'])}`,
          data: null,
          scope: 'Preparation failed before evidence was available',
          sourceRefs: [],
          coverage: { complete: false, gaps: [reason] },
          omissions: [],
          applicability: 'unknown' as const,
          view: { id: grader.view.id, version: grader.view.version },
          serializationVersion: 'canonical-json-v1' as const,
        };
        const evidence = { ...missing, contentHash: await contentHash(missing) };
        if (!record.evidence.some((item) => item.id === evidence.id)) {
          record.evidence.push(evidence);
        }
        addGrade(
          grader,
          evidence,
          { verdict: 'unknown', reason },
          signal?.aborted ? 'cancelled' : 'preparation_error',
        );
        continue;
      }

      for (const evidence of items) {
        if (signal?.aborted) {
          addGrade(
            grader,
            evidence,
            { verdict: 'unknown', reason: 'Grading cancelled' },
            'cancelled',
          );
        } else if (evidence.applicability === 'not_applicable') {
          addGrade(grader, evidence, {
            verdict: 'not_applicable',
            reason: 'Requirement does not apply to this scope',
          });
        } else if (evidence.applicability === 'unknown' || !evidence.coverage.complete) {
          addGrade(grader, evidence, {
            verdict: 'unknown',
            reason: 'Applicability or required evidence coverage is incomplete',
          });
        } else if (grader.kind === 'code') {
          try {
            addGrade(grader, evidence, await grader.check(evidence, trial));
          } catch {
            addGrade(
              grader,
              evidence,
              { verdict: 'unknown', reason: 'Code grader failed' },
              'grader_error',
            );
          }
        } else {
          record.jobs.push({
            id: `j${record.jobs.length + 1}`,
            grader: { id: grader.id, version: grader.version },
            evidence,
            question: grader.question,
            rubric: grader.rubric,
          });
        }
      }
    }

    const byJob = (id: string) => record.jobs.find((job) => job.id === id)!;

    const modelGrade = (
      id: string,
      result: CheckResult,
      status: Grade['status'],
      metadata?: Record<string, unknown>,
    ) => {
      const job = byJob(id);
      addGrade(
        graders.find((grader) => grader.id === job.grader.id)!,
        job.evidence,
        result,
        status,
        metadata,
      );
    };

    if (record.jobs.length) {
      try {
        if (!options.judge) {
          throw new Error('No judge configured');
        }

        const requests = await options.judge.prepare(immutableCopy(record.jobs));
        const membership = requests.flatMap((request) => request.jobIds);
        if (
          membership.length !== record.jobs.length ||
          new Set(membership).size !== membership.length ||
          membership.some((id) => !byJob(id)) ||
          new Set(requests.map((request) => request.id)).size !== requests.length ||
          requests.some(
            (request) =>
              !request.jobIds.length ||
              !Number.isFinite(request.reservedCostUsd) ||
              request.reservedCostUsd < 0,
          )
        ) {
          throw new Error('Invalid prepared judge batch membership');
        }

        record.requests = requests.map((request) => ({
          request: immutableCopy({
            ...request,
            metadata: { ...request.metadata, trialId, gradingId: record.id },
          }),
          dispatched: false,
        }));

        const reservation = requests.reduce((sum, request) => sum + request.reservedCostUsd, 0);
        const admitted = budget.used + reservation <= allowance;
        if (admitted) {
          budget.used += reservation;
        }

        for (const entry of record.requests) {
          await options.store.saveRequest(record.id, entry.request);
          if (!admitted || budget.used > allowance || signal?.aborted) {
            entry.error = signal?.aborted
              ? 'Cancelled before dispatch'
              : 'Aggregate judge budget exceeded before dispatch';
          } else {
            try {
              entry.dispatched = true;
              const response = immutableCopy(await options.judge.execute(entry.request, signal));
              const returned = Array.isArray(response?.answers)
                ? response.answers.map((answer) => answer?.jobId)
                : [];
              if (
                returned.length !== entry.request.jobIds.length ||
                new Set(returned).size !== returned.length ||
                returned.some((id) => !entry.request.jobIds.includes(id)) ||
                response.answers.some((answer) => !gradingVerdicts.includes(answer.verdict)) ||
                !response.model ||
                response.raw === undefined ||
                !validObservedUsage(response.usage)
              ) {
                throw new JudgeExecutionError(
                  'Invalid judge response membership',
                  response,
                  validObservedUsage(response?.usage) ? response.usage : undefined,
                );
              }
              entry.response = response;
              for (const answer of response.answers) {
                modelGrade(answer.jobId, { verdict: answer.verdict }, 'completed', {
                  ...answer.metadata,
                  judge: options.judge.id,
                  requestId: entry.request.id,
                  model: response.model,
                });
              }
            } catch (error) {
              if (error instanceof JudgeExecutionError) {
                if (validObservedUsage(error.observedUsage)) {
                  const { inputTokens, outputTokens, estimatedCostUsd } = error.observedUsage;
                  entry.observedUsage = { inputTokens, outputTokens, estimatedCostUsd };
                }
                try {
                  if (error.receivedResponse !== undefined) {
                    entry.receivedResponse = immutableCopy(error.receivedResponse);
                  }
                } catch {
                  // Keep the safe message and observed usage even when payload storage fails.
                }
              }
              if (signal?.aborted) {
                entry.error = 'Judge request cancelled';
              } else if (error instanceof JudgeExecutionError) {
                entry.error = error.message;
              } else {
                entry.error = 'Judge request failed; no safe provider response was available';
              }
            }
          }

          const observedCost = (entry.response?.usage ?? entry.observedUsage)?.estimatedCostUsd;
          if (entry.dispatched && observedCost != null) {
            budget.used += Math.max(0, observedCost - entry.request.reservedCostUsd);
          }

          if (entry.error) {
            for (const id of entry.request.jobIds) {
              modelGrade(
                id,
                { verdict: 'unknown', reason: entry.error },
                signal?.aborted ? 'cancelled' : 'grader_error',
              );
            }
          }
        }
      } catch (error) {
        for (const entry of record.requests) {
          if (!entry.dispatched && !entry.error) {
            entry.error = 'Request was not dispatched because preparation or recording failed';
          }
        }
        for (const job of record.jobs) {
          if (
            !record.grades.some(
              (grade) => grade.grader.id === job.grader.id && grade.evidenceId === job.evidence.id,
            )
          ) {
            const reason =
              error instanceof JudgePreparationError
                ? error.message
                : 'Judge preparation or request recording failed';
            let status: Grade['status'] = 'grader_error';
            if (signal?.aborted) {
              status = 'cancelled';
            } else if (error instanceof JudgePreparationError) {
              status = 'preparation_error';
            }

            modelGrade(job.id, { verdict: 'unknown', reason }, status);
          }
        }
      }
    }

    record.rollups = rollupGrades(record.grades, graders, record.evidence);
    await options.store.saveGrading(record);

    return record;
  }

  return gradeTrial;
}
