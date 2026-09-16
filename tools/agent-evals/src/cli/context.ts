import type { CliRequest } from './arguments.ts';
import type { ConsoleOutput } from './output.ts';

export interface CommandContext {
  repo: string;
  callerCwd: string;
  request: CliRequest;
  output: ConsoleOutput;
  signal?: AbortSignal;
}

export const timestampId = () => new Date().toISOString().replaceAll(/[:.]/g, '-');
