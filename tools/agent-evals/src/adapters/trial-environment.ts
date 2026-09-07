import { randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { PreparedEnvironment, Task } from '../domain/types.ts';
import { collectTrialArtifacts } from './isolation/artifacts.ts';
import { prepareBoundary, type PreparedBoundary } from './isolation/boundary.ts';
import { cleanupPrivateTrial } from './isolation/cleanup.ts';
import { verifyPrivatePiAuthentication } from './isolation/native-auth.ts';
import { preparePiConfiguration, type InspectedPi } from './isolation/pi-configuration.ts';
import {
  initializeFixtureGit,
  verifyFixtureCommands,
  verifySandboxRuntime,
} from './isolation/preflight.ts';
import { reserveLocalPort, TrialProcesses } from './isolation/processes.ts';
import {
  prepareResources,
  sha256,
  validateResourceSelection,
  verifyPreparedResources,
} from './isolation/resources.ts';
import { resolveLocalRuntime } from './isolation/runtime.ts';
import type { SandboxCommandResult } from './isolation/sandbox.ts';
import { createTrialPaths } from './isolation/trial-paths.ts';

export { VALIDATION_INSTRUCTION } from './isolation/resources.ts';
export interface TrialEnvironmentOptions {
  sourceRepo: string;
  task: Task;
  variant: 'enabled' | 'disabled';
  pi: InspectedPi;
  id?: string;
  fixtureDir?: string;
  runtimeMs?: number;
  signal?: AbortSignal;
}
export interface PreparedTrialEnvironment extends PreparedEnvironment {
  runCommand(executable: string, args: string[]): Promise<SandboxCommandResult>;
}

/**
 * Prepare one synthetic local trial. Each setup step owns one boundary concern;
 * all private files and child processes share the same unconditional cleanup.
 */
export async function prepareTrialEnvironment(
  options: TrialEnvironmentOptions,
): Promise<PreparedTrialEnvironment> {
  options.signal?.throwIfAborted();
  if (!options.pi?.packageRoot || !options.pi.agentDir || !options.pi.resources) {
    throw new Error('Inspect the installed Pi runtime before preparing an evaluation environment.');
  }
  const sourceRepo = await realpath(options.sourceRepo);
  const fixtureDirectory = await realpath(
    options.fixtureDir ?? join(sourceRepo, 'evals/fixtures/wedding-copy'),
  );
  const runtime = await resolveLocalRuntime(sourceRepo);
  const selection = validateResourceSelection(sourceRepo, options.pi.resources);
  const paths = await createTrialPaths(selection.ancestors.length);
  const processes = new TrialProcesses(paths.processRegistry);
  await processes.initialize();
  const runtimeMs = options.runtimeMs ?? 90_000;
  let boundary: PreparedBoundary | undefined;

  const cleanup = () =>
    cleanupPrivateTrial(paths.privateFiles, async () => {
      try {
        await boundary?.run(
          runtime.node.executable,
          [runtime.playwright.executable, 'close-all'],
          5000,
        );
      } finally {
        await processes.stop();
      }
    });

  try {
    options.signal?.throwIfAborted();
    const resources = await prepareResources({
      sourceRepo,
      fixtureDirectory,
      paths,
      variant: options.variant,
      native: options.pi.resources,
    });
    options.signal?.throwIfAborted();
    const port = await reserveLocalPort();
    const url = `http://127.0.0.1:${port}`;
    boundary = await prepareBoundary({
      paths,
      runtime,
      resources,
      packageRoot: options.pi.packageRoot,
      targetFile: options.task.targetFile,
      id: options.id ?? randomUUID(),
      port,
      runtimeMs,
      registerProcess: processes.register,
    });
    const { run } = boundary;
    options.signal?.throwIfAborted();
    await initializeFixtureGit(paths.workspace, boundary.toolEnv);
    const preflight = await verifyFixtureCommands(paths, run, runtimeMs);
    options.signal?.throwIfAborted();
    await processes.startFixture(paths, runtime.node.executable, boundary.toolEnv, url);
    const runtimeEvidence = await verifySandboxRuntime(runtime, paths, run);
    options.signal?.throwIfAborted();

    // Copy authentication last, after tool prerequisites pass, to preserve the
    // validity reserved for the actual bounded Pi execution.
    const authentication = await preparePiConfiguration(options.pi, paths, runtimeMs);
    options.signal?.throwIfAborted();
    const effectiveDiscovery = await verifyPreparedResources(
      paths,
      options.pi.packageRoot,
      resources,
      { executable: runtime.node.executable, env: boundary.agentEnv },
    );
    await verifyPrivatePiAuthentication({
      destination: join(paths.piDirectory, 'auth.json'),
      provider: authentication.provider,
      runtimeMs,
    });
    options.signal?.throwIfAborted();
    return {
      root: paths.root,
      workspace: paths.workspace,
      url,
      env: boundary.agentEnv,
      agentArgs: boundary.agentArgs,
      provenance: {
        runtime: runtimeEvidence,
        preflight,
        fixtureRevision: resources.fixtureRevision,
        fixtureFiles: resources.fixtureFiles,
        resources: resources.resources,
        sourceProfile: resources.sourceProfile,
        skillTreeFingerprint: resources.skillTreeFingerprint,
        effectiveDiscovery,
        isolation: 'macos-sandbox-exec-v1',
        profileSha256: sha256(await readFile(paths.profile)),
        extensionSha256: sha256(await readFile(paths.extension)),
        originalInstructionSha256: resources.originalInstructionSha256,
        effectiveInstructionSha256: resources.effectiveInstructionSha256,
        variant: options.variant,
        instructionChange: resources.instructionChange,
        suppressedExtensions: true,
        resourceProfile:
          'Native discovery of inspected winning resources in their original user/project scope; ancestry and selected system/context filenames preserved; profile deviations recorded in sourceProfile',
        services: [url],
        sourceRepo,
        workspace: paths.workspace,
        authentication,
        auth: 'selected provider copied privately after native locked refresh; full-run validity verified; inaccessible to agent tools; private copy removed by cleanup',
      },
      runCommand(executable, args) {
        const effectiveArgs =
          basename(executable).startsWith('playwright-cli') && args.includes('open')
            ? [...args, `--config=${paths.browserConfig}`]
            : args;
        return run(executable, effectiveArgs);
      },
      collectArtifacts: () =>
        collectTrialArtifacts({
          paths,
          targetFile: options.task.targetFile,
          nodeExecutable: runtime.node.executable,
          run,
        }),
      cleanup,
    };
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Trial setup and process cleanup failed; private credential deletion was attempted.',
      );
    }
    throw error;
  }
}
