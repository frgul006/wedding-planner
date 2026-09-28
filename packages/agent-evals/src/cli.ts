#!/usr/bin/env node
import { safeError } from './adapters/redaction.ts';
import { installCancellationHandlers } from './cli/cancellation.ts';
import { command } from './cli/command.ts';
import { disposeConfigLoader } from './cli/config.ts';

const cancellation = installCancellationHandlers(() => {
  process.stderr.write('Cancelling evaluation; cleaning up and saving captured evidence…\n');
});
try {
  process.exitCode = await command(process.argv.slice(2), {
    cwd: process.cwd(),
    signal: cancellation.signal,
  });
} catch (error) {
  const message = safeError(error);
  process.stderr.write(
    process.argv.includes('--json')
      ? JSON.stringify({ error: message }) + '\n'
      : `Evaluation needs attention\n\n${message}\n\nHelp: agent-evals --help\n`,
  );
  process.exitCode = 1;
} finally {
  process.exitCode = cancellation.exitCode ?? process.exitCode;
  cancellation.dispose();
  await disposeConfigLoader();
}
