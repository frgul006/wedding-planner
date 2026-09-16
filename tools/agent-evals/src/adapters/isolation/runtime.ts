import { execFile } from 'node:child_process';
import { access, readFile, readdir, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { resolveExecutable } from './sandbox.ts';

const execute = promisify(execFile);

/** Find a real pnpm installation; do not put a network-capable Corepack shim in trials. */
export async function resolvePinnedPnpm(
  pinnedVersion: string,
  nodeExecutable: string,
): Promise<{ executable: string; directory: string; version: string }> {
  const candidates: string[] = [];
  try {
    candidates.push(await resolveExecutable('pnpm'));
  } catch {
    /* Try Corepack's installed cache. */
  }
  const corepackHome = process.env.COREPACK_HOME ?? join(homedir(), '.cache/node/corepack');
  for (const cache of [corepackHome, join(homedir(), 'Library/Caches/node/corepack')])
    for (const layout of ['v1/pnpm', 'pnpm'])
      candidates.push(
        join(
          cache,
          layout,
          pinnedVersion,
          'bin',
          Number(pinnedVersion.split('.')[0]) >= 12 ? 'pnpm.mjs' : 'pnpm.cjs',
        ),
      );
  for (const candidate of new Set(candidates)) {
    try {
      const executable = await realpath(candidate);
      const directory = dirname(dirname(executable));
      const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as {
        name?: string;
        version?: string;
      };
      if (manifest.name !== 'pnpm' || manifest.version !== pinnedVersion) continue;
      const actual = await version(nodeExecutable, [executable, '--version'], 'pinned pnpm');
      if (actual === pinnedVersion) return { executable, directory, version: actual };
    } catch {
      /* Missing cache entries and Corepack shims are not the runtime. */
    }
  }
  throw new Error(
    `Pinned pnpm ${pinnedVersion} is not installed. Run pnpm install first, or install pnpm ${pinnedVersion} directly on PATH. COREPACK_HOME is supported.`,
  );
}

export interface LocalRuntime {
  platform: 'darwin';
  architecture: 'arm64' | 'x64';
  node: { executable: string; version: string };
  pnpm: { executable: string; directory: string; version: string };
  playwright: { executable: string; version: string };
  browser: { executable: string; directory: string; version: string };
}

async function version(executable: string, args: string[], label: string): Promise<string> {
  try {
    const result = await execute(executable, args, { timeout: 5000, maxBuffer: 64_000 });
    const output = result.stdout.trim();
    if (output) return output;
  } catch {
    /* Translate local process failures into an actionable prerequisite. */
  }
  throw new Error(`Cannot run ${label}. Repair its local installation before starting a trial.`);
}

/** Select a complete installation for this architecture, newest revision first. */
export async function resolveHeadlessBrowser(cache: string, architecture: 'arm64' | 'x64') {
  let entries: string[];
  try {
    entries = await readdir(cache);
  } catch {
    throw new Error(
      'Playwright browser cache is missing. Install its Chromium headless shell before running evaluations.',
    );
  }
  const candidates = entries
    .filter((name) => /^chromium_headless_shell-\d+$/.test(name))
    .sort((left, right) => Number(right.split('-').at(-1)) - Number(left.split('-').at(-1)));
  for (const candidate of candidates) {
    const directory = join(cache, candidate, `chrome-headless-shell-mac-${architecture}`);
    const executable = join(directory, 'chrome-headless-shell');
    try {
      await access(executable, constants.X_OK);
      return { directory, executable };
    } catch {
      /* Skip an incomplete or differently architected installation. */
    }
  }
  throw new Error(
    `No executable Playwright Chromium headless shell is installed for macOS ${architecture}. Install the matching browser runtime first.`,
  );
}

/** Doctor and trials resolve the same pinned tools; no trial directories are created. */
export async function resolveLocalRuntime(sourceRepo: string): Promise<LocalRuntime> {
  if (process.platform !== 'darwin') {
    throw new Error(
      'Isolated evaluations require macOS sandbox-exec. No unsandboxed fallback is supported.',
    );
  }
  if (process.arch !== 'arm64' && process.arch !== 'x64') {
    throw new Error(
      `The macOS evaluation sandbox does not support the ${process.arch} architecture.`,
    );
  }
  try {
    await access('/usr/bin/sandbox-exec', constants.X_OK);
  } catch {
    throw new Error('macOS sandbox-exec is unavailable; isolated trials cannot start.');
  }

  const nodeExecutable = await realpath(process.execPath);
  const repository = JSON.parse(await readFile(join(sourceRepo, 'package.json'), 'utf8')) as {
    packageManager?: string;
    engines?: { node?: string };
  };
  const requiredNodeMajor = repository.engines?.node?.match(/^\^(\d+)\./)?.[1];
  if (requiredNodeMajor && process.versions.node.split('.')[0] !== requiredNodeMajor) {
    throw new Error(
      `The repository requires Node ${repository.engines!.node}; this process uses ${process.version}. Run nvm use before evaluations.`,
    );
  }
  const pinnedVersion = repository.packageManager?.match(/^pnpm@([0-9.]+)/)?.[1];
  if (!pinnedVersion)
    throw new Error('Pin the repository pnpm version in package.json before running evaluations.');
  const pnpm = await resolvePinnedPnpm(pinnedVersion, nodeExecutable);

  let playwrightExecutable: string;
  try {
    playwrightExecutable = await resolveExecutable('playwright-cli');
  } catch {
    throw new Error(
      'playwright-cli is not installed on PATH. Install it before running evaluations.',
    );
  }
  const browser = await resolveHeadlessBrowser(
    process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), 'Library/Caches/ms-playwright'),
    process.arch,
  );
  const [playwrightVersion, browserVersion] = await Promise.all([
    version(nodeExecutable, [playwrightExecutable, '--version'], 'playwright-cli'),
    version(browser.executable, ['--version'], 'the Playwright Chromium headless shell'),
  ]);
  return {
    platform: 'darwin',
    architecture: process.arch,
    node: { executable: nodeExecutable, version: process.version },
    pnpm,
    playwright: { executable: playwrightExecutable, version: playwrightVersion },
    browser: { ...browser, version: browserVersion },
  };
}
