import type { Grade, TrialEvidence } from './types.ts';

export function gradeAcceptance(evidence: TrialEvidence): Grade {
  const checks = evidence.checks;
  const grade = (verdict: Grade['verdict'], reason: string): Grade => ({
    grader: 'acceptance-checks',
    version: '1',
    verdict,
    reason,
    evidenceRefs: checks?.map((check) => check.id) ?? [],
  });
  if (!evidence.task.acceptance)
    return grade('not-applicable', 'This task does not select independent acceptance checks.');
  if (!checks?.length || checks.some((check) => check.actor !== 'evaluator'))
    return grade('unknown', 'No trusted final acceptance checks were captured.');
  if (
    checks.some(
      (check) => check.status === 'fail' || (check.exitCode !== null && check.exitCode !== 0),
    )
  )
    return grade(
      'fail',
      `Independent acceptance failed: ${checks
        .filter(
          (check) => check.status === 'fail' || (check.exitCode !== null && check.exitCode !== 0),
        )
        .map((check) => check.id)
        .join(', ')}.`,
    );
  if (checks.some((check) => check.status === 'unknown' || check.exitCode === null))
    return grade(
      'unknown',
      'At least one independent acceptance check did not finish conclusively.',
    );
  return grade('pass', 'All evaluator-run final acceptance checks passed.');
}

export function gradeDiffScope(evidence: TrialEvidence): Grade {
  const allowed = evidence.task.allowedChangedPaths;
  const grade = (verdict: Grade['verdict'], reason: string): Grade => ({
    grader: 'diff-scope',
    version: '1',
    verdict,
    reason,
    evidenceRefs: evidence.patch ? [evidence.patch.id] : [],
  });
  if (!allowed) return grade('not-applicable', 'This task does not restrict changed paths.');
  if (!evidence.changedFiles || !evidence.patch)
    return grade('unknown', 'The evaluator did not capture the complete final change set.');
  const unexpected = evidence.changedFiles.filter((file) => !allowed.includes(file));
  return unexpected.length
    ? grade('fail', `Files outside the allowed change scope: ${unexpected.join(', ')}.`)
    : grade('pass', 'Every changed file is within the task’s allowed change scope.');
}
