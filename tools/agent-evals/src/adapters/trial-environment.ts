import { randomUUID } from 'node:crypto';
import { copyFile, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { CommandCheck, PreparedEnvironment, Task } from '../domain/types.ts';
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
import { runSandboxCommand, type SandboxCommandResult } from './isolation/sandbox.ts';
import { createTrialPaths } from './isolation/trial-paths.ts';
import {
  prepareRepositoryCheckout,
  prepareRepositoryRuntime,
  repositoryGit,
} from './isolation/repository-checkout.ts';
import {
  collectRepositoryEvidence,
  independentCommand,
  snapshotRepository,
} from './isolation/repository-evidence.ts';

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
  piRuntime?: 'native' | 'controlled';
}
export interface PreparedTrialEnvironment extends PreparedEnvironment {
  runCommand(executable: string, args: string[]): Promise<SandboxCommandResult>;
  verifyAcceptance?(): Promise<CommandCheck>;
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
  const resourceSource = await realpath(options.pi.resources.cwd);
  const repository = options.task.environment === 'repository';
  const fixtureDirectory = await realpath(
    options.fixtureDir ?? join(sourceRepo, 'evals/fixtures/wedding-copy'),
  );
  const runtime = await resolveLocalRuntime(sourceRepo, resourceSource);
  const selection = validateResourceSelection(resourceSource, options.pi.resources);
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
    const repositoryProvenance = repository
      ? await prepareRepositoryCheckout({
          sourceRepo,
          dependencyRepo: resourceSource,
          revision: options.task.repository!.revision,
          paths,
          acceptance: options.task.acceptance,
        })
      : undefined;
    const repositoryFiles = repository ? await snapshotRepository(paths.workspace) : undefined;
    const resources = await prepareResources({
      sourceRepo: resourceSource,
      fixtureDirectory: repository ? paths.workspace : fixtureDirectory,
      paths,
      variant: options.variant,
      native: options.pi.resources,
      repositoryWorkspace: repository,
    });
    if (repositoryFiles) {
      resources.fixtureFiles = [...repositoryFiles.values()].map(({ path, sha256: digest }) => ({
        path,
        sha256: digest,
      }));
      resources.fixtureRevision = sha256(JSON.stringify(resources.fixtureFiles));
    }
    options.signal?.throwIfAborted();
    const port = await reserveLocalPort();
    const url = `http://127.0.0.1:${port}`;
    const agentContext = [
      `The local development server is already running at ${url}.`,
      ...(repository
        ? [
            'This isolated runtime supports the webpack bundler. Use pnpm build --webpack for a production build; the default Turbopack build requires process/port access outside this boundary.',
            'This environment has no running database or authentication service. The local login failure path is available; successful sign-in and seeded-database E2E flows cannot complete here.',
          ]
        : []),
    ].join('\n\n');
    const repositoryRuntime = repository ? await prepareRepositoryRuntime(paths, port) : undefined;
    const acceptanceScript = join(paths.control, 'repository-acceptance.mjs');
    let testModule: string | undefined;
    if (repository) {
      await copyFile(
        fileURLToPath(new URL('./isolation/repository-acceptance.mjs', import.meta.url)),
        acceptanceScript,
      );
      testModule = createRequire(join(resourceSource, 'package.json')).resolve('@playwright/test');
    }
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
      toolEnvironment: repositoryRuntime?.environment,
      trustedReadableFiles: repositoryRuntime ? [repositoryRuntime.fontResponses] : [],
      trustedReadableDirectories: repository ? [join(resourceSource, 'node_modules')] : [],
    });
    const { run } = boundary;
    if (repository)
      await writeFile(
        paths.profile,
        (await readFile(paths.profile, 'utf8')) +
          `\n(deny file-write* (subpath ${JSON.stringify(join(paths.workspace, 'node_modules'))}))\n`,
      );
    const verifyAcceptance = async () => {
      const evaluatorProfile = join(paths.control, 'evaluator.sb');
      await writeFile(
        evaluatorProfile,
        (await readFile(paths.profile, 'utf8')) +
          `\n(allow file-read* (literal ${JSON.stringify(acceptanceScript)}))\n`,
      );
      const evaluatorRun = (executable: string, args: string[], timeoutMs?: number) =>
        runSandboxCommand(evaluatorProfile, executable, args, {
          cwd: paths.workspace,
          env: boundary!.toolEnv,
          timeoutMs,
          onSpawn: processes.register,
          signal: options.signal,
        });
      return independentCommand(
        evaluatorRun,
        'repository-browser-acceptance',
        runtime.node.executable,
        [
          acceptanceScript,
          testModule!,
          runtime.browser.executable,
          url,
          options.task.acceptance!,
          join(paths.workspace, options.task.targetFile),
        ],
        90_000,
      );
    };
    options.signal?.throwIfAborted();
    if (!repository) await initializeFixtureGit(paths.workspace, boundary.toolEnv);
    const preflight = repository ? [] : await verifyFixtureCommands(paths, run, runtimeMs);
    options.signal?.throwIfAborted();
    if (repository)
      await processes.startRepository(
        paths,
        runtime.node.executable,
        boundary.toolEnv,
        url,
        options.signal,
      );
    else await processes.startFixture(paths, runtime.node.executable, boundary.toolEnv, url);
    const runtimeEvidence = await verifySandboxRuntime(runtime, paths, run);
    options.signal?.throwIfAborted();

    // Copy authentication last, after tool prerequisites pass, to preserve the
    // validity reserved for the actual bounded Pi execution.
    const authentication = await preparePiConfiguration(
      options.pi,
      paths,
      runtimeMs,
      options.piRuntime ?? 'native',
    );
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
    let repositoryBaseline: Awaited<ReturnType<typeof snapshotRepository>> | undefined;
    let baselineCommit = '';
    if (repository) {
      await repositoryGit(paths.workspace, ['add', '-A'], boundary.toolEnv);
      await repositoryGit(
        paths.workspace,
        [
          '-c',
          'user.name=Evaluation Setup',
          '-c',
          'user.email=eval@example.invalid',
          'commit',
          '--allow-empty',
          '-m',
          'Frozen repository evaluation starting state',
        ],
        boundary.toolEnv,
      );
      baselineCommit = (
        await repositoryGit(paths.workspace, ['rev-parse', 'HEAD'], boundary.toolEnv)
      ).stdout.trim();
      repositoryBaseline = await snapshotRepository(paths.workspace);
    }
    return {
      root: paths.root,
      workspace: paths.workspace,
      url,
      env: boundary.agentEnv,
      agentArgs: boundary.agentArgs,
      agentContext,
      provenance: {
        agentContext,
        runtime: runtimeEvidence,
        comparableRuntime: {
          node: runtimeEvidence.node.version,
          pnpm: runtimeEvidence.pnpm.version,
          playwright: runtimeEvidence.playwright.version,
          browser: runtimeEvidence.browser.version,
          fileWorkerSha256: runtimeEvidence.fileWorkerSha256,
          platform: runtime.platform,
          architecture: runtime.architecture,
          ...(repositoryProvenance
            ? {
                lockfileSha256: repositoryProvenance.lockfileSha256,
                installedLockfileSha256: repositoryProvenance.installedLockfileSha256,
              }
            : {}),
        },
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
        agentConfiguration: {
          runtime: options.piRuntime ?? 'native',
          extensionPolicy: 'disabled',
          tools: ['read', 'bash', 'edit', 'write'],
        },
        ...(repositoryProvenance
          ? {
              repository: {
                ...repositoryProvenance,
                baselineCommit,
                runtime:
                  'Next.js dev --webpack and pnpm build --webpack; pnpm lint; private preinstalled dependencies; no external network',
                limitations: [
                  'Offline Google font responses use system font fallbacks.',
                  'Default Turbopack build requires process/port access outside the isolated boundary; development and production checks use webpack.',
                  'PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false prevents copied-path dependency reinstallation; the evaluator independently verifies pinned and installed application lockfiles before copying dependencies.',
                  'The unavailable loopback auth endpoint exercises only login failure UI; successful authentication, Supabase and production integrations are not evaluated.',
                ],
              },
            }
          : {}),
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
      ...(repositoryBaseline
        ? {
            verifyAcceptance,
            finalize: async () => {
              await processes.stop();
              const finalSource = await snapshotRepository(paths.workspace);
              // Agent-writable build output cannot be an input to trusted acceptance.
              await rm(join(paths.workspace, '.next'), { recursive: true, force: true });
              const checks: CommandCheck[] = [];
              const acceptanceRun = (executable: string, args: string[], timeoutMs?: number) =>
                runSandboxCommand(paths.profile, executable, args, {
                  cwd: paths.workspace,
                  env: boundary!.toolEnv,
                  timeoutMs,
                  onSpawn: processes.register,
                  signal: options.signal,
                });
              checks.push(
                await independentCommand(
                  acceptanceRun,
                  'repository-lint',
                  join(paths.runtimeBin, 'pnpm'),
                  ['lint'],
                ),
              );
              checks.push(
                await independentCommand(
                  acceptanceRun,
                  'repository-build',
                  join(paths.runtimeBin, 'pnpm'),
                  ['build', '--webpack'],
                ),
              );
              try {
                if (!options.signal?.aborted) {
                  await processes.startRepository(
                    paths,
                    runtime.node.executable,
                    boundary!.toolEnv,
                    url,
                    options.signal,
                  );
                  checks.push(await verifyAcceptance());
                }
              } catch (error) {
                if (!options.signal?.aborted) throw error;
              } finally {
                await processes.stop();
              }
              if (!checks.some((check) => check.id === 'repository-browser-acceptance'))
                checks.push({
                  id: 'repository-browser-acceptance',
                  actor: 'evaluator',
                  command: ['evaluator-browser-acceptance'],
                  exitCode: null,
                  stdout: '',
                  stderr: 'Acceptance cancelled before browser verification.',
                  status: 'unknown',
                });
              const afterChecks = await snapshotRepository(paths.workspace);
              const stable =
                JSON.stringify([...finalSource.values()]) ===
                JSON.stringify([...afterChecks.values()]);
              checks.push({
                id: 'acceptance-source-stability',
                actor: 'evaluator' as const,
                command: ['evaluator-source-inventory'],
                exitCode: stable ? 0 : 1,
                stdout: stable ? 'Source files unchanged by independent acceptance commands.' : '',
                stderr: stable
                  ? ''
                  : 'Independent checks modified source files; grades cannot describe the originally captured result.',
                status: stable ? ('pass' as const) : ('fail' as const),
              });
              const artifacts = await collectTrialArtifacts({
                paths,
                targetFile: options.task.targetFile,
                nodeExecutable: runtime.node.executable,
                run,
              });
              return collectRepositoryEvidence({
                workspace: paths.workspace,
                baseline: repositoryBaseline!,
                baselineCommit,
                env: boundary!.toolEnv,
                checks,
                artifacts,
                final: finalSource,
              });
            },
          }
        : {}),
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
