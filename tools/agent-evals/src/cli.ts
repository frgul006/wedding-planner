import { fileURLToPath } from 'node:url';
import { safeError } from './adapters/secrets.ts';
import { installCancellationHandlers } from './cli/cancellation.ts';

/** Composition root: parse once, dispatch once, keep infrastructure out of the core. */
async function main(argv: string[], signal: AbortSignal): Promise<number> {
  const [command, ...args] = argv;
  if (command !== undefined && !['library', 'help', '--help', '-h'].includes(command))
    throw new Error('Use pnpm evals library run, library regrade RUN_ID, or library show RUN_ID');
  const { libraryCommand } = await import('./cli/library-command.ts');
  return libraryCommand(command === 'library' ? args : ['--help', ...args], {
    repo: fileURLToPath(new URL('../../../', import.meta.url)),
    // pnpm changes cwd to the workspace package but preserves the caller here.
    callerCwd: process.env.INIT_CWD ?? process.cwd(),
    signal,
  });
}

const cancellation = installCancellationHandlers(() => {
  process.stderr.write('Cancelling evaluation; cleaning up and saving captured evidence…\n');
});
try {
  process.exitCode = await main(process.argv.slice(2), cancellation.signal);
} catch (error) {
  const message = safeError(error);
  process.stderr.write(
    process.argv.includes('--json')
      ? JSON.stringify({ error: message }) + '\n'
      : `Evaluation needs attention\n\n${message}\n\nHelp: pnpm evals --help\n`,
  );
  process.exitCode = 1;
} finally {
  process.exitCode = cancellation.exitCode ?? process.exitCode;
  cancellation.dispose();
}
