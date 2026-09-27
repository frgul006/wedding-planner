import { readFile } from 'node:fs/promises';
import { sha256 } from 'agent-evals/pi';
import type { RunSandboxedCommand } from './boundary.ts';
import type { LocalRuntime } from './runtime.ts';
import type { TrialPaths } from './trial-paths.ts';

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
    pnpm: {
      executable: runtime.pnpm.executable,
      version: runtime.pnpm.version,
    },
    playwright: {
      executable: runtime.playwright.executable,
      version: playwright.stdout.trim(),
    },
    browser: {
      executable: runtime.browser.executable,
      version: browser.stdout.trim(),
      configurationSha256: sha256(await readFile(paths.browserConfig)),
    },
    fileWorkerSha256: sha256(await readFile(paths.fileWorker)),
  };
}
