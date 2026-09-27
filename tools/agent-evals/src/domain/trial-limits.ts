/** Limits apply independently to each agent trial, never to grading or a whole suite. */
export interface TrialLimits {
  /** Agent execution time, including Pi startup; environment setup/finalization is separate. */
  runtimeMs: number;
  /** Completed assistant turns, including each turn's tool executions. */
  maxTurns: number;
  /** Input + output + 0.1 × (cache reads + cache writes), summed across calls. */
  maxTokens: number;
}

export const DEFAULT_TRIAL_LIMITS: Readonly<TrialLimits> = Object.freeze({
  runtimeMs: 3_600_000,
  maxTurns: 500,
  maxTokens: 5_000_000,
});
export const CACHED_TOKEN_WEIGHT = 0.1;
/** Node timers must not overflow and silently become a one-millisecond deadline. */
export const MAX_RUNTIME_MS = 2_147_483_647;

/** Later layers override earlier fields. Undefined fields inherit; invalid values never do. */
export function resolveTrialLimits(...layers: (Partial<TrialLimits> | undefined)[]): TrialLimits {
  const limits = { ...DEFAULT_TRIAL_LIMITS };
  for (const layer of layers) {
    if (layer === undefined) continue;
    if (layer === null || typeof layer !== 'object' || Array.isArray(layer))
      throw new Error('Trial limits must be an object');
    for (const [key, value] of Object.entries(layer)) {
      if (!Object.hasOwn(DEFAULT_TRIAL_LIMITS, key)) throw new Error(`Unknown trial limit: ${key}`);
      if (value === undefined) continue;
      if (!Number.isSafeInteger(value) || value <= 0)
        throw new Error(`${key} must be a positive safe integer`);
      if (key === 'runtimeMs' && value > MAX_RUNTIME_MS)
        throw new Error(`runtimeMs must be at most ${MAX_RUNTIME_MS} (timer range)`);
      limits[key as keyof TrialLimits] = value;
    }
  }
  return limits;
}

export function weightedTokens(usage: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}): number {
  return (
    usage.inputTokens +
    usage.outputTokens +
    (usage.cacheReadTokens + usage.cacheWriteTokens) * CACHED_TOKEN_WEIGHT
  );
}
