import type { Usage } from '../types.js';
import { object, type JsonObject } from './pi-rpc-process.ts';

const number = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

export class UsageAccumulator {
  private finished = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  private streaming: JsonObject = {};
  private known = false;
  private observedTokens = false;

  private add(usage: JsonObject): void {
    this.observedTokens ||= ['input', 'output', 'cacheRead', 'cacheWrite'].some(
      (field) => typeof usage[field] === 'number',
    );
    for (const field of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) {
      this.finished[field] += number(usage[field]);
    }
    this.finished.cost += number(object(usage.cost).total);
    this.known ||= typeof object(usage.cost).total === 'number';
  }

  accept(event: JsonObject): void {
    if (event.type === 'compaction_end') {
      this.add(object(object(event.result).usage));
    }
    if (event.type === 'response' && event.command === 'get_session_stats') {
      const stats = object(event.data);
      const tokens = object(stats.tokens);
      // Session totals include compacted history and native summarization calls.
      // Reconcile totals rather than adding them to already observed messages.
      for (const field of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) {
        this.finished[field] = Math.max(this.finished[field], number(tokens[field]));
      }
      this.finished.cost = Math.max(this.finished.cost, number(stats.cost));
      // Pi initializes empty session totals to zero even when no provider usage
      // was returned. Such a summary cannot turn an unknown request into $0.
      const observedTotals = ['input', 'output', 'cacheRead', 'cacheWrite'].some(
        (field) => number(tokens[field]) > 0,
      );
      this.observedTokens ||= observedTotals;
      this.known ||= typeof stats.cost === 'number' && (stats.cost > 0 || observedTotals);
    }

    if (event.type === 'message_start') {
      this.streaming = {};
    }

    if (event.type === 'message_update') {
      this.streaming = object(event.usage);
    }

    if (event.type === 'message_end') {
      const message = object(event.message);
      if (message.role === 'assistant' || message.role === 'toolResult') {
        const usage = object(message.usage);
        if (Object.keys(usage).length) {
          this.add(usage);
        }
      }
      this.streaming = {};
    }
  }

  value(): Usage {
    const streamingCost = object(this.streaming.cost).total;
    const observedTokens =
      this.observedTokens ||
      ['input', 'output', 'cacheRead', 'cacheWrite'].some(
        (field) => typeof this.streaming[field] === 'number',
      );
    return {
      inputTokens: this.finished.input + number(this.streaming.input),
      outputTokens: this.finished.output + number(this.streaming.output),
      cacheReadTokens: this.finished.cacheRead + number(this.streaming.cacheRead),
      cacheWriteTokens: this.finished.cacheWrite + number(this.streaming.cacheWrite),
      estimatedCostUsd:
        this.known || typeof streamingCost === 'number'
          ? this.finished.cost + number(streamingCost)
          : null,
      costSource: observedTokens
        ? 'Pi provider-reported usage × Pi catalog prices; estimate, not billing or a provider-enforced cap'
        : 'Unknown: no successful usage response',
    };
  }
}
