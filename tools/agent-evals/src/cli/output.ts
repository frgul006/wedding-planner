import type { Grade, TrialEvidence, Usage } from '../domain/types.ts';

export class ConsoleOutput {
  constructor(readonly json: boolean) {}

  result(value: unknown, human: string): void {
    process.stdout.write(
      this.json ? JSON.stringify(value, null, 2) + '\n' : human.trimEnd() + '\n',
    );
  }

  progress(message: string): void {
    if (!this.json)
      process.stderr.write(`${message}
`);
  }

  /** Long native calls stay visibly alive without exposing raw model/tool text. */
  async during<T>(message: string, action: () => Promise<T>): Promise<T> {
    this.progress(message);
    const started = Date.now();
    const timer = setInterval(
      () => this.progress(`  Still working · ${formatDuration(Date.now() - started)} elapsed`),
      20_000,
    );
    timer.unref();
    try {
      return await action();
    } finally {
      clearInterval(timer);
    }
  }
}

export function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return 'unknown duration';
  const seconds = Math.round(milliseconds / 1_000);
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

export function formatCost(usd: unknown): string {
  return typeof usd === 'number' && Number.isFinite(usd)
    ? `$${usd.toFixed(6)} estimated`
    : 'unknown';
}

export function formatObservedTokens(usage: Usage): string {
  // Older recordings represent absent responses as zero placeholders plus this marker.
  if (
    /^Unknown: (?:no successful usage response|agent did not return usage)/.test(usage.costSource)
  ) {
    return 'token usage unknown';
  }
  const total =
    usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  return `${total.toLocaleString('en-US')} observed tokens`;
}

export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] ?? '').length)),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, index) => cell.padEnd(widths[index]))
      .join('  ')
      .trimEnd();
  return [line(headers), ...rows.map(line)].join('\n');
}

export function gradeLines(grades: Grade[]): string {
  return grades
    .map((grade) => {
      const label = grade.verdict === 'not-applicable' ? 'N/A' : grade.verdict.toUpperCase();
      const detail =
        grade.verdict === 'pass'
          ? ''
          : `
           ${grade.reason}`;
      return `  ${label.padEnd(8)} ${grade.grader} · v${grade.version}${detail}`;
    })
    .join('\n');
}

export function trialSummary(
  evidence: TrialEvidence,
  grades: Grade[],
  report: string,
  apiCost: unknown,
): string {
  const duration = Date.parse(evidence.agent.endedAt) - Date.parse(evidence.agent.startedAt);
  return `Trial ${evidence.agent.status} · ${evidence.task.id} · instruction ${evidence.variant}

${gradeLines(grades)}

Pi: ${formatObservedTokens(evidence.agent.usage)} · ${formatDuration(duration)}
API grader: ${apiCost === 'not-run' ? 'not run · $0' : formatCost(apiCost)}
${
  evidence.agent.error
    ? `
Cause: ${evidence.agent.error}
`
    : ''
}
Report: ${report}
Next: pnpm evals show latest`;
}
