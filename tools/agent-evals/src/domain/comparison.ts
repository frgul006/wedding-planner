export interface ComparableTrial {
  variant: string;
  invariants: unknown;
  comparisonEligible: boolean;
  /** Include selected grading provenance when comparing a regrade instead of original judgments. */
  grading?: unknown;
}

export interface InvariantMismatch {
  path: string;
  left: unknown;
  right: unknown;
}
export interface ComparisonResult {
  eligible: boolean;
  reason: string;
  mismatches: InvariantMismatch[];
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Object key order is immaterial; array ordering and missing keys are part of the evidence. */
export function invariantMismatches(
  left: unknown,
  right: unknown,
  path = 'invariants',
): InvariantMismatch[] {
  if (Object.is(left, right)) return [];
  if (Array.isArray(left) && Array.isArray(right)) {
    const mismatches: InvariantMismatch[] = [];
    for (let index = 0; index < Math.max(left.length, right.length); index++) {
      const itemPath = `${path}[${index}]`;
      if (index >= left.length || index >= right.length)
        mismatches.push({ path: itemPath, left: left[index], right: right[index] });
      else mismatches.push(...invariantMismatches(left[index], right[index], itemPath));
    }
    return mismatches;
  }
  if (record(left) && record(right)) {
    return [...new Set([...Object.keys(left), ...Object.keys(right)])]
      .sort()
      .flatMap((key) =>
        !Object.hasOwn(left, key) || !Object.hasOwn(right, key)
          ? [{ path: `${path}.${key}`, left: left[key], right: right[key] }]
          : invariantMismatches(left[key], right[key], `${path}.${key}`),
      );
  }
  return [{ path, left, right }];
}

export function compareTrials(left: ComparableTrial, right: ComparableTrial): ComparisonResult {
  if (!left.comparisonEligible || !right.comparisonEligible)
    return {
      eligible: false,
      reason:
        'Active duplicate instructions or incomplete provenance prevent a controlled comparison.',
      mismatches: [],
    };
  if (
    new Set([left.variant, right.variant]).size !== 2 ||
    ![left.variant, right.variant].every((variant) => ['enabled', 'disabled'].includes(variant))
  )
    return {
      eligible: false,
      reason: 'Comparison requires one enabled and one disabled trial.',
      mismatches: [],
    };
  if (
    !record(left.invariants) ||
    !record(right.invariants) ||
    !Object.keys(left.invariants).length ||
    !Object.keys(right.invariants).length
  )
    return {
      eligible: false,
      reason:
        'Saved trial invariants are missing or incomplete; a controlled comparison cannot be established.',
      mismatches: [],
    };
  const mismatches = [
    ...invariantMismatches(left.invariants, right.invariants),
    ...invariantMismatches(left.grading, right.grading, 'grading'),
  ];
  if (mismatches.length)
    return {
      eligible: false,
      reason: `Comparison conditions differ: ${mismatches.map((mismatch) => mismatch.path).join(', ')}.`,
      mismatches,
    };
  return {
    eligible: true,
    reason:
      'Matched controlled pair. Report observations only; repeat paired trials before estimating usefulness. A few successful disabled runs do not show that an instruction is unnecessary.',
    mismatches: [],
  };
}
