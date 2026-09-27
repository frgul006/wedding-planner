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
import { verifySandboxRuntime } from './isolation/preflight.ts';
import { DEFAULT_TRIAL_LIMITS } from '../domain/trial-limits.ts';
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

export interface TrialEnvironmentOptions {
  sourceRepo: string;
  task: Task;
  pi: InspectedPi;
  id?: string;
  runtimeMs?: number;
  signal?: AbortSignal;
}
export interface PreparedTrialEnvironment extends PreparedEnvironment {
  runCommand(executable: string, args: string[]): Promise<SandboxCommandResult>;
  verifyAcceptance(): Promise<CommandCheck>;
}

/**
 * Prepare one isolated repository trial. Each setup step owns one boundary concern;
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
  if (!options.task.repository) throw new Error('Pi trials require a pinned repository task.');
  const runtime = await resolveLocalRuntime(sourceRepo, resourceSource);
  const selection = validateResourceSelection(resourceSource, options.pi.resources);
  const paths = await createTrialPaths(selection.ancestors.length);
  const processes = new TrialProcesses(paths.processRegistry);
  await processes.initialize();
  const runtimeMs = options.runtimeMs ?? DEFAULT_TRIAL_LIMITS.runtimeMs;
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
    const repositoryProvenance = await prepareRepositoryCheckout({
      sourceRepo,
      dependencyRepo: resourceSource,
      revision: options.task.repository.revision,
      paths,
      acceptance: options.task.acceptance,
    });
    const repositoryFiles = await snapshotRepository(paths.workspace);
    const resources = await prepareResources({
      sourceRepo: resourceSource,
      paths,
      native: options.pi.resources,
    });
    const fixtureFiles = [...repositoryFiles.values()].map(({ path, sha256: digest }) => ({
      path,
      sha256: digest,
    }));
    options.signal?.throwIfAborted();
    const port = await reserveLocalPort();
    const url = `http://127.0.0.1:${port}`;
    const agentContext = [
      `The local development server is already running at ${url}.`,
      'This isolated runtime supports the webpack bundler. Use pnpm build --webpack for a production build; the default Turbopack build requires process/port access outside this boundary.',
      'This environment has no running database or authentication service. The local login failure path is available; successful sign-in and seeded-database E2E flows cannot complete here.',
    ].join('\n\n');
    const repositoryRuntime = await prepareRepositoryRuntime(paths, port);
    const acceptanceScript = join(paths.control, 'repository-acceptance.mjs');
    await copyFile(
      fileURLToPath(new URL('./isolation/repository-acceptance.mjs', import.meta.url)),
      acceptanceScript,
    );
    const testModule = createRequire(join(resourceSource, 'package.json')).resolve(
      '@playwright/test',
    );
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
      toolEnvironment: repositoryRuntime.environment,
      trustedReadableFiles: [repositoryRuntime.fontResponses],
      trustedReadableDirectories: [join(resourceSource, 'node_modules')],
    });
    const { run } = boundary;
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
        [acceptanceScript, testModule, runtime.browser.executable, url, options.task.acceptance!],
        90_000,
      );
    };
    options.signal?.throwIfAborted();
    await processes.startRepository(
      paths,
      runtime.node.executable,
      boundary.toolEnv,
      url,
      options.signal,
    );
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
    const baselineCommit = (
      await repositoryGit(paths.workspace, ['rev-parse', 'HEAD'], boundary.toolEnv)
    ).stdout.trim();
    const repositoryBaseline = await snapshotRepository(paths.workspace);
    return {
      root: paths.root,
      workspace: paths.workspace,
      url,
      env: boundary.agentEnv,
      agentArgs: boundary.agentArgs,
      agentContext,
      provenance: {
        agentContext,
        runtime: {
          ...runtimeEvidence,
          platform: runtime.platform,
          architecture: runtime.architecture,
        },
        fixtureRevision: sha256(JSON.stringify(fixtureFiles)),
        fixtureFiles,
        resources: resources.resources,
        recordedContexts: resources.recordedContexts,
        contextCaptureGaps: resources.contextCaptureGaps,
        sourceProfile: resources.sourceProfile,
        skillTreeFingerprint: resources.skillTreeFingerprint,
        effectiveDiscovery,
        isolation: 'macos-sandbox-exec-v1',
        profileSha256: sha256(await readFile(paths.profile)),
        extensionSha256: sha256(await readFile(paths.extension)),
        suppressedExtensions: true,
        resourceProfile:
          'Native discovery of inspected winning resources in their original user/project scope; ancestry and selected system/context filenames preserved; profile deviations recorded in sourceProfile',
        services: [url],
        sourceRepo,
        agentConfiguration: {
          runtime: 'native',
          ...(options.pi.endpointSelection ? { endpoint: options.pi.endpointSelection } : {}),
          extensionPolicy: 'disabled',
          tools: ['read', 'bash', 'edit', 'write'],
        },
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
          JSON.stringify([...finalSource.values()]) === JSON.stringify([...afterChecks.values()]);
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
          baseline: repositoryBaseline,
          env: boundary!.toolEnv,
          checks,
          artifacts,
          final: finalSource,
        });
      },
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
