import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { sha256 } from './resources.ts';
import type { RunSandboxedCommand } from './boundary.ts';
import type { LocalRuntime } from './runtime.ts';
import type { SandboxCommandResult } from './sandbox.ts';
import type { TrialPaths } from './trial-paths.ts';

const execute = promisify(execFile);
export interface PreflightObservation extends SandboxCommandResult {
  actor: 'environment';
  executable: string;
  args: string[];
  timestamp: string;
}

export async function initializeFixtureGit(
  workspace: string,
  toolEnv: Record<string, string>,
): Promise<void> {
  const options = { cwd: workspace, env: { ...toolEnv, GIT_CONFIG_NOSYSTEM: '1' } };
  const identity = ['-c', 'user.name=Evaluation Fixture', '-c', 'user.email=eval@example.invalid'];
  await execute('/usr/bin/git', ['init', '-b', 'codex/eval-trial'], options);
  await execute('/usr/bin/git', [...identity, 'add', '.'], options);
  await execute(
    '/usr/bin/git',
    [...identity, 'commit', '-m', 'Synthetic wedding evaluation fixture'],
    options,
  );
}

/** Environment commands are recorded separately and cannot earn compliance credit. */
export async function verifyFixtureCommands(
  paths: TrialPaths,
  run: RunSandboxedCommand,
  runtimeMs: number,
): Promise<PreflightObservation[]> {
  const commands = [
    { executable: '/usr/bin/git', args: ['--version'] },
    { executable: '/usr/bin/git', args: ['status', '--porcelain'] },
    { executable: join(paths.runtimeBin, 'pnpm'), args: ['lint'] },
    { executable: join(paths.runtimeBin, 'pnpm'), args: ['build'] },
  ];
  const observations: PreflightObservation[] = [];
  for (const command of commands) {
    const result = await run(command.executable, command.args, Math.min(runtimeMs, 20_000));
    observations.push({
      actor: 'environment',
      ...command,
      ...result,
      timestamp: new Date().toISOString(),
    });
    await writeFile(paths.preflight, JSON.stringify(observations, null, 2));
    if (result.exitCode !== 0) {
      throw new Error(
        `Isolated prerequisite failed: ${command.executable} ${command.args.join(' ')}. Environment evidence: ${paths.preflight}`,
      );
    }
  }
  return observations;
}

/** Verify the resolver's exact binaries within the restriction used by agent tools. */
export async function verifySandboxRuntime(
  runtime: LocalRuntime,
  paths: TrialPaths,
  run: RunSandboxedCommand,
) {
  const browser = await run(runtime.browser.executable, ['--version'], 5000);
  if (browser.exitCode !== 0 || browser.stdout.trim() !== runtime.browser.version) {
    throw new Error('Cannot verify the selected browser runtime inside the evaluation sandbox.');
  }
  const playwright = await run(
    runtime.node.executable,
    [runtime.playwright.executable, '--version'],
    5000,
  );
  if (playwright.exitCode !== 0 || playwright.stdout.trim() !== runtime.playwright.version) {
    throw new Error(
      'Cannot verify the selected playwright-cli runtime inside the evaluation sandbox.',
    );
  }
  return {
    node: runtime.node,
    pnpm: { executable: runtime.pnpm.executable, version: runtime.pnpm.version },
    playwright: { executable: runtime.playwright.executable, version: playwright.stdout.trim() },
    browser: {
      executable: runtime.browser.executable,
      version: browser.stdout.trim(),
      configurationSha256: sha256(await readFile(paths.browserConfig)),
    },
    fileWorkerSha256: sha256(await readFile(paths.fileWorker)),
  };
}
