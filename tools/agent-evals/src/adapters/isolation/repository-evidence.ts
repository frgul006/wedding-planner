import { readFile, readdir, lstat, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import type { Artifact, CommandCheck, FinalObservation } from '../../domain/types.ts';
import type { RunSandboxedCommand } from './boundary.ts';
import { repositoryGit } from './repository-checkout.ts';
import { safeFile } from './sandbox.ts';
import { sha256 } from './resources.ts';

const generated = new Set([
  '.git',
  'node_modules',
  '.next',
  '.playwright',
  '.playwright-cli',
  'test-results',
  'playwright-report',
]);
export interface RepositoryFile {
  path: string;
  sha256: string;
  content: string;
  mode: number;
  binary: boolean;
}

/** Independent filesystem inventory does not trust mutable .gitignore, index or agent commits. */
export async function snapshotRepository(workspace: string): Promise<Map<string, RepositoryFile>> {
  const files = new Map<string, RepositoryFile>();
  let total = 0;
  async function walk(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (
        directory === workspace &&
        (generated.has(entry.name) ||
          entry.name === 'next-env.d.ts' ||
          entry.name.endsWith('.tsbuildinfo'))
      )
        continue;
      const full = join(directory, entry.name);
      const path = relative(workspace, full);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isSymbolicLink())
        throw new Error(`Final source contains an unsupported symlink: ${path}`);
      else if (entry.isFile()) {
        await safeFile(workspace, path);
        const bytes = await readFile(full);
        total += bytes.length;
        if (total > 32_000_000)
          throw new Error('Repository evidence exceeds the 32 MB retained-source bound.');
        const binary = bytes.includes(0);
        files.set(path, {
          path,
          sha256: sha256(bytes),
          content: binary ? `base64:${bytes.toString('base64')}` : bytes.toString('utf8'),
          mode: (await lstat(full)).mode & 0o777,
          binary,
        });
      }
    }
  }
  await walk(workspace);
  return files;
}

function artifact(id: string, path: string, content: string): Artifact {
  return { id, path, content, sha256: sha256(content), observedBy: 'evaluator' };
}

export async function collectRepositoryEvidence(options: {
  workspace: string;
  baseline: Map<string, RepositoryFile>;
  baselineCommit: string;
  env: Record<string, string>;
  checks: CommandCheck[];
  artifacts: Artifact[];
  final?: Map<string, RepositoryFile>;
}): Promise<FinalObservation> {
  const final = options.final ?? (await snapshotRepository(options.workspace));
  const changedFiles = [...new Set([...options.baseline.keys(), ...final.keys()])]
    .filter((path) => {
      const before = options.baseline.get(path),
        after = final.get(path);
      return before?.sha256 !== after?.sha256 || before?.mode !== after?.mode;
    })
    .sort();
  const beforeArtifacts: Artifact[] = [];
  const artifacts = options.artifacts.map((item) => {
    const captured = final.get(item.path);
    return captured ? artifact(item.id, item.path, captured.content) : item;
  });
  for (const [index, path] of changedFiles.entries()) {
    const before = options.baseline.get(path),
      after = final.get(path);
    if (before) beforeArtifacts.push(artifact(`before-file-${index + 1}`, path, before.content));
    if (after && !artifacts.some((item) => item.path === path))
      artifacts.push(artifact(`final-file-${index + 1}`, path, after.content));
  }
  const patchDirectory = await mkdtemp(join(tmpdir(), 'wedding-eval-diff-'));
  let patchText = '';
  try {
    for (const name of ['before', 'after']) await mkdir(join(patchDirectory, name));
    for (const path of changedFiles) {
      for (const [name, file] of [
        ['before', options.baseline.get(path)],
        ['after', final.get(path)],
      ] as const) {
        if (!file) continue;
        const destination = join(patchDirectory, name, path);
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(
          destination,
          file.binary ? Buffer.from(file.content.slice(7), 'base64') : file.content,
          { mode: file.mode },
        );
      }
    }
    try {
      patchText = (
        await repositoryGit(
          patchDirectory,
          [
            'diff',
            '--no-index',
            '--binary',
            '--no-ext-diff',
            '--no-textconv',
            '--',
            'before',
            'after',
          ],
          options.env,
        )
      ).stdout;
    } catch (error) {
      const result = error as { code?: number; stdout?: string };
      if (result.code !== 1 || typeof result.stdout !== 'string') throw error;
      patchText = result.stdout;
    }
    patchText = patchText.replaceAll('a/before/', 'a/').replaceAll('b/after/', 'b/');
  } finally {
    await rm(patchDirectory, { recursive: true, force: true });
  }
  artifacts.push(
    artifact(
      'repository-file-manifest',
      'evaluator/repository-files.json',
      JSON.stringify(
        {
          changedFiles,
          files: [...final.values()].map(({ path, sha256: digest, mode, binary }) => ({
            path,
            sha256: digest,
            mode,
            binary,
          })),
        },
        null,
        2,
      ),
    ),
  );
  return {
    artifacts,
    beforeArtifacts,
    changedFiles,
    patch: artifact('repository-patch', 'evaluator/changes.patch', patchText),
    checks: options.checks,
  };
}

export async function independentCommand(
  run: RunSandboxedCommand,
  id: string,
  executable: string,
  args: string[],
  timeout = 120_000,
): Promise<CommandCheck> {
  try {
    const result = await run(executable, args, timeout);
    return {
      id,
      actor: 'evaluator',
      command: [executable, ...args],
      ...result,
      status: result.exitCode === 0 ? 'pass' : result.exitCode === null ? 'unknown' : 'fail',
    };
  } catch (error) {
    return {
      id,
      actor: 'evaluator',
      command: [executable, ...args],
      exitCode: null,
      stdout: '',
      stderr: error instanceof Error ? error.message : 'Acceptance command failed',
      status: 'unknown',
    };
  }
}
