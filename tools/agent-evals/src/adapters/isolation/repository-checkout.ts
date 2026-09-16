import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { cp, mkdir, readFile, readdir, readlink, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { sha256 } from './resources.ts';
import { isWithin, minimalEnvironment } from './sandbox.ts';
import type { TrialPaths } from './trial-paths.ts';

const execute = promisify(execFile);
export const REPOSITORY_ACCEPTANCE_IDS = new Set([
  'admin-login-copy',
  'local-development-docs',
  'admin-login-visible-error',
]);
const excludedResourceNames = [
  'AGENTS.md',
  'AGENTS.MD',
  'AGENTS.override.md',
  'CLAUDE.md',
  'CLAUDE.MD',
  '.pi',
  '.agents',
];

export async function repositoryGit(
  workspace: string,
  args: string[],
  env: Record<string, string>,
) {
  return execute(
    '/usr/bin/git',
    ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args],
    {
      cwd: workspace,
      env,
      maxBuffer: 24_000_000,
      timeout: 60_000,
    },
  );
}

async function validateDependencyLinks(root: string, directory = root): Promise<void> {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) await validateDependencyLinks(root, path);
    else if (item.isSymbolicLink()) {
      const target = resolve(dirname(path), await readlink(path));
      if (!isWithin(root, target) || !isWithin(root, await realpath(path)))
        throw new Error(`Installed dependency links outside node_modules: ${relative(root, path)}`);
    }
  }
}

/** A shallow, independent checkout: no shared object store, worktree metadata, inherited env or hooks. */
export async function prepareRepositoryCheckout(options: {
  sourceRepo: string;
  dependencyRepo: string;
  revision: string;
  paths: TrialPaths;
  acceptance?: string;
}) {
  const { paths, revision } = options;
  if (!options.acceptance || !REPOSITORY_ACCEPTANCE_IDS.has(options.acceptance))
    throw new Error(`Unknown repository acceptance check: ${options.acceptance ?? 'missing'}`);
  if (!/^[a-f0-9]{40}$/.test(revision))
    throw new Error('Repository trials require a full pinned commit SHA.');
  const env = minimalEnvironment(paths.toolHome, paths.temporary, dirname(process.execPath));
  const tree = await repositoryGit(options.sourceRepo, ['ls-tree', '-r', '-z', revision], env);
  for (const item of tree.stdout.split('\0').filter(Boolean)) {
    const [metadata, path] = item.split('\t');
    if (
      !metadata?.startsWith('100') ||
      !path ||
      path.split('/').some((part) => /^(\.env(?!\.example$)|auth\.json$)/i.test(part))
    )
      throw new Error(
        `Repository snapshot contains an unsupported symlink, submodule or private file: ${path ?? 'unknown'}`,
      );
  }
  await repositoryGit(paths.workspace, ['init', '-b', 'codex/eval-trial'], env);
  await repositoryGit(
    paths.workspace,
    [
      '-c',
      'protocol.file.allow=always',
      'fetch',
      '--depth=1',
      '--no-tags',
      options.sourceRepo,
      revision,
    ],
    env,
  );
  await repositoryGit(paths.workspace, ['checkout', '--detach', revision], env);
  const pinnedLock = await readFile(join(paths.workspace, 'pnpm-lock.yaml'));
  const installedLock = await readFile(join(options.dependencyRepo, 'pnpm-lock.yaml'));
  if (!pinnedLock.equals(installedLock))
    throw new Error(
      'The installed dependency checkout does not match the pinned repository lockfile. Install that revision separately before running.',
    );
  const dependencies = await realpath(join(options.dependencyRepo, 'node_modules'));
  const installedModulesLock = await readFile(join(dependencies, '.pnpm/lock.yaml'));
  // pnpm 12 prefixes the source lock with a separate package-manager document;
  // the installed modules lock retains only the application's final document.
  const appLock = (bytes: Buffer) =>
    bytes
      .toString('utf8')
      .split(/^---\s*$/m)
      .at(-1)!
      .trim();
  if (appLock(pinnedLock) !== appLock(installedModulesLock))
    throw new Error(
      'Installed node_modules does not match the pinned application dependency lock. Install that revision before running.',
    );
  await validateDependencyLinks(dependencies);
  // COPYFILE_FICLONE uses private copy-on-write files on APFS, never mutable hardlinks.
  await cp(dependencies, join(paths.workspace, 'node_modules'), {
    recursive: true,
    dereference: false,
    verbatimSymlinks: true,
    mode: constants.COPYFILE_FICLONE,
  });
  for (const name of excludedResourceNames)
    await rm(join(paths.workspace, name), { recursive: true, force: true });
  let seededPatch: string | null = null;
  if (options.acceptance === 'admin-login-visible-error') {
    const path = join(paths.workspace, 'app/admin/login/login-form.tsx');
    const original = await readFile(path, 'utf8');
    const needle = 'className="rounded-lg bg-red-50';
    if (original.split(needle).length !== 2)
      throw new Error('Pinned login error fixture no longer matches its authored defect.');
    await writeFile(path, original.replace(needle, 'className="hidden rounded-lg bg-red-50'));
    seededPatch = (
      await repositoryGit(
        paths.workspace,
        ['diff', '--no-ext-diff', '--no-textconv', '--', 'app/admin/login/login-form.tsx'],
        env,
      )
    ).stdout;
  }
  return {
    revision,
    lockfileSha256: sha256(pinnedLock),
    installedLockfileSha256: sha256(installedModulesLock),
    dependencySource: options.dependencyRepo,
    dependencies: 'Private copy of preinstalled dependencies; no install scripts or downloads run',
    seededPatch,
  };
}

export async function prepareRepositoryRuntime(paths: TrialPaths, port: number) {
  const fontResponses = join(paths.control, 'offline-fonts.cjs');
  await writeFile(
    fontResponses,
    "module.exports = new Proxy({}, { get: (_target, url) => String(url).includes('Geist+Mono') ? \"@font-face { font-family: 'Geist Mono'; src: local('Courier New'); font-display: swap; }\" : \"@font-face { font-family: 'Geist'; src: local('Arial'); font-display: swap; }\" });\n",
  );
  const environment = {
    // The evaluator already verifies pinned and installed application locks.
    // pnpm's copied-path verification would try reinstalling immutable dependencies.
    PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: 'false',
    NEXT_TELEMETRY_DISABLED: '1',
    WATCHPACK_POLLING: 'true',
    NEXT_FONT_GOOGLE_MOCKED_RESPONSES: fontResponses,
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${port}/__evaluation_auth_unavailable`,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'evaluation-local-placeholder',
    SUPABASE_SECRET_KEY: 'evaluation-local-placeholder',
    SITE_URL: `http://127.0.0.1:${port}`,
  };
  await writeFile(
    join(paths.workspace, '.env.local'),
    Object.entries(environment)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') + '\n',
  );
  await mkdir(join(paths.workspace, '.git/info'), { recursive: true });
  await writeFile(join(paths.workspace, '.git/info/exclude'), '\n.playwright/\n');
  return { environment, fontResponses };
}
