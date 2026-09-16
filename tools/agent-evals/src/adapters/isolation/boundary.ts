import { cp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  minimalEnvironment,
  runSandboxCommand,
  runtimeRoot,
  sandboxProfile,
  type SandboxCommandResult,
} from './sandbox.ts';
import type { LocalRuntime } from './runtime.ts';
import type { PreparedResources } from './resources.ts';
import type { TrialPaths } from './trial-paths.ts';

const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
export type RunSandboxedCommand = (
  executable: string,
  args: string[],
  timeoutMs?: number,
) => Promise<SandboxCommandResult>;
export interface PreparedBoundary {
  toolEnv: Record<string, string>;
  agentEnv: Record<string, string>;
  agentArgs: string[];
  run: RunSandboxedCommand;
}

async function installRuntimeLaunchers(paths: TrialPaths, runtime: LocalRuntime): Promise<void> {
  for (const [name, executable] of [
    ['pnpm', runtime.pnpm.executable],
    ['playwright-cli', runtime.playwright.executable],
  ]) {
    const script = `#!/bin/sh\nexec ${shellQuote(runtime.node.executable)} ${shellQuote(executable!)} "$@"\n`;
    await writeFile(join(paths.runtimeBin, name!), script, { mode: 0o755 });
  }
}

async function installBrowserConfiguration(
  paths: TrialPaths,
  runtime: LocalRuntime,
): Promise<void> {
  await mkdir(join(paths.workspace, '.playwright'), { recursive: true });
  await symlink(paths.browserConfig, join(paths.workspace, '.playwright/cli.config.json'));
  await writeFile(
    paths.browserConfig,
    JSON.stringify({
      browser: {
        browserName: 'chromium',
        launchOptions: {
          executablePath: runtime.browser.executable,
          headless: true,
          chromiumSandbox: false,
          args: ['--no-sandbox', '--disable-gpu'],
        },
      },
    }),
  );
}

/** Install immutable launchers/configuration and a single loopback-only tool boundary. */
export async function prepareBoundary(options: {
  paths: TrialPaths;
  runtime: LocalRuntime;
  resources: PreparedResources;
  packageRoot: string;
  targetFile: string;
  id: string;
  port: number;
  runtimeMs: number;
  registerProcess: (pid: number) => void;
  toolEnvironment?: Record<string, string>;
  trustedReadableFiles?: string[];
  trustedReadableDirectories?: string[];
}): Promise<PreparedBoundary> {
  const { paths, runtime, resources } = options;
  await installRuntimeLaunchers(paths, runtime);
  await installBrowserConfiguration(paths, runtime);
  const helpers = fileURLToPath(new URL('./', import.meta.url));
  await cp(join(helpers, 'pi-tool-boundary.mjs'), paths.extension);
  await cp(join(helpers, 'file-worker.mjs'), paths.fileWorker);

  const toolEnv = minimalEnvironment(
    paths.toolHome,
    paths.temporary,
    dirname(runtime.node.executable),
  );
  toolEnv.PATH = paths.runtimeBin + ':' + toolEnv.PATH;
  toolEnv.PLAYWRIGHT_CLI_SESSION = 'eval-' + options.id.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 8);
  toolEnv.PORT = String(options.port);
  Object.assign(toolEnv, options.toolEnvironment);
  const writableDirectories = [paths.workspace, paths.toolHome, paths.temporary];
  const readableDirectories = [
    '/System',
    '/usr',
    '/bin',
    '/sbin',
    '/Library/Apple',
    '/Library/Fonts',
    '/Library/Developer/CommandLineTools',
    '/Applications/Google Chrome.app',
    '/opt/homebrew/Cellar',
    '/opt/homebrew/opt',
    '/opt/homebrew/bin',
    '/opt/homebrew/lib',
    runtimeRoot(runtime.node.executable),
    runtimeRoot(dirname(dirname(runtime.playwright.executable))),
    runtime.browser.directory,
    runtime.pnpm.directory,
    paths.runtimeBin,
    resources.skillsDirectory,
    ...(options.trustedReadableDirectories ?? []),
  ];
  await writeFile(
    paths.profile,
    sandboxProfile({
      workspace: paths.workspace,
      writableDirectories,
      readableDirectories,
      port: options.port,
      readableFiles: [
        ...resources.readableFiles,
        paths.browserConfig,
        paths.fileWorker,
        ...(options.trustedReadableFiles ?? []),
        '/private/etc/passwd',
        '/private/etc/group',
        '/private/etc/localtime',
      ],
    }),
  );
  await writeFile(
    paths.boundaryConfig,
    JSON.stringify({
      browserConfigPath: paths.browserConfig,
      processRegistryPath: paths.processRegistry,
      snapshotReceiptDirectory: paths.snapshotReceipts,
      workspace: paths.workspace,
      targetFile: resolve(paths.workspace, options.targetFile),
      piModule: join(options.packageRoot, 'dist/index.js'),
      profilePath: paths.profile,
      workerPath: paths.fileWorker,
      nodeExecutable: runtime.node.executable,
      playwrightExecutable: runtime.playwright.executable,
      toolEnv,
      writableDirectories,
      resourceDirectories: [resources.skillsDirectory],
      resourceFiles: [...resources.readableFiles, paths.browserConfig],
      commandTimeoutMs: options.runtimeMs,
    }),
  );
  return {
    toolEnv,
    agentEnv: {
      ...minimalEnvironment(
        paths.toolHome,
        join(paths.control, 'tmp'),
        dirname(runtime.node.executable),
      ),
      PI_CODING_AGENT_DIR: paths.piDirectory,
      EVAL_ISOLATION_CONFIG: paths.boundaryConfig,
    },
    agentArgs: [
      '--no-extensions',
      '-e',
      paths.extension,
      '--tools',
      'read,bash,edit,write',
      '--approve',
    ],
    run: (executable, args, timeoutMs = options.runtimeMs) =>
      runSandboxCommand(paths.profile, executable, args, {
        cwd: paths.workspace,
        env: toolEnv,
        timeoutMs,
        onSpawn: options.registerProcess,
      }),
  };
}
