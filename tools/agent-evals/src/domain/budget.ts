/** Estimates are admission controls, never provider-enforced spending caps. */
export class EstimatedBudget {
  private reserved = 0;
  constructor(readonly limitUsd: number) {
    if (!Number.isFinite(limitUsd) || limitUsd <= 0 || limitUsd > 1)
      throw new Error('Pilot estimated budget must be > $0 and <= $1');
  }
  reserve(usd: number): void {
    if (!Number.isFinite(usd) || usd < 0 || this.reserved + usd > this.limitUsd + 1e-9)
      throw new Error('Estimated API budget exceeded before dispatch');
    this.reserved += usd;
  }
  get reservedUsd() {
    return this.reserved;
  }
}
export interface TokenPrices {
  inputPerMillion: number;
  outputPerMillion: number;
  source: string;
}
export function estimateCost(input: number, output: number, prices: TokenPrices): number {
  return (input * prices.inputPerMillion + output * prices.outputPerMillion) / 1_000_000;
}
