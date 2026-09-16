import { fileURLToPath } from 'node:url';
import { safeError } from './adapters/secrets.ts';
import { helpText, parseCommand } from './cli/arguments.ts';
import { installCancellationHandlers } from './cli/cancellation.ts';
import type { CommandContext } from './cli/context.ts';
import { ConsoleOutput } from './cli/output.ts';

/** Composition root: parse once, dispatch once, keep infrastructure out of the core. */
async function main(argv: string[], signal: AbortSignal): Promise<number> {
  const request = parseCommand(argv);
  const output = new ConsoleOutput(Boolean(request.values.json));
  const context: CommandContext = {
    repo: fileURLToPath(new URL('../../../', import.meta.url)),
    // pnpm changes cwd to the workspace package but preserves the caller here.
    callerCwd: process.env.INIT_CWD ?? process.cwd(),
    request,
    output,
    signal,
  };
  switch (request.command) {
    case 'help':
      output.result({ help: helpText(request.helpTopic) }, helpText(request.helpTopic));
      return 0;
    case 'tasks':
    case 'profiles':
    case 'validate':
      return (await import('./cli/commands/catalog.ts')).catalogCommand(context);
    case 'runs':
    case 'show':
    case 'regrade':
    case 'compare':
      return (await import('./cli/commands/saved.ts')).savedCommand(context);
    case 'doctor':
      return (await import('./cli/commands/doctor.ts')).doctorCommand(context);
    case 'run':
      return (await import('./cli/commands/run.ts')).runCommand(context);
    case 'experiment':
      return (await import('./cli/commands/experiment.ts')).experimentCommand(context);
    case 'grader-smoke':
      return (await import('./cli/commands/grader-smoke.ts')).graderSmokeCommand(context);
  }
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
