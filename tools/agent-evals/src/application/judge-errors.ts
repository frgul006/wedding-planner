import type { JudgeResponse } from '../domain/library.ts';

/** A provider-independent preparation failure whose message is safe to retain. */
export class JudgePreparationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JudgePreparationError';
  }
}

/** Only explicitly credential-free messages and optional provider data may cross this boundary. */
export class JudgeExecutionError extends Error {
  constructor(
    message: string,
    readonly receivedResponse?: unknown,
    readonly observedUsage?: JudgeResponse['usage'],
  ) {
    super(message);
    this.name = 'JudgeExecutionError';
  }
}

export function validObservedUsage(value: unknown): value is JudgeResponse['usage'] {
  if (!value || typeof value !== 'object') return false;
  const usage = value as JudgeResponse['usage'];
  return (
    Number.isSafeInteger(usage.inputTokens) &&
    usage.inputTokens >= 0 &&
    Number.isSafeInteger(usage.outputTokens) &&
    usage.outputTokens >= 0 &&
    (usage.estimatedCostUsd === null ||
      (Number.isFinite(usage.estimatedCostUsd) && usage.estimatedCostUsd >= 0))
  );
}
