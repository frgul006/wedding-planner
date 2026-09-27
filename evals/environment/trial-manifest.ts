import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EvaluationTask } from 'agent-evals';
import { isolatedPiSettings } from 'agent-evals/pi';

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function treeHash(directory: string): Promise<string> {
  const records: string[] = [];
  async function visit(folder: string): Promise<void> {
    const entries = (await readdir(folder, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      if (entry.name === 'node_modules') continue;
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile())
        records.push(`${path.relative(directory, file)}:${hashText(await readFile(file, 'utf8'))}`);
      else throw new Error(`Unexpected symlink in versioned evaluation input: ${file}`);
    }
  }
  await visit(directory);
  return hashText(records.join('\n'));
}

/** Unique reproducibility inputs; native selection and runtime facts have their own recordings. */
export async function createTrialManifest(
  repo: string,
  task: EvaluationTask,
  conversationSettings: Record<string, unknown>,
) {
  const [packageHash, environmentHash, viewsHash, tasksHash, config, lockfile] = await Promise.all([
    // Hash the installed public package, whether workspace-linked or installed elsewhere.
    treeHash(path.dirname(fileURLToPath(import.meta.resolve('agent-evals')))),
    treeHash(path.join(repo, 'evals/environment')),
    treeHash(path.join(repo, 'evals/views')),
    treeHash(path.join(repo, 'evals/tasks')),
    readFile(path.join(repo, 'evals/config.ts'), 'utf8'),
    readFile(path.join(repo, 'pnpm-lock.yaml'), 'utf8'),
  ]);
  return {
    packageHash,
    environmentHash,
    viewsHash,
    tasksHash,
    configHash: hashText(config),
    taskHash: hashText(JSON.stringify(task)),
    dependencyLockHash: hashText(lockfile),
    settings: isolatedPiSettings(conversationSettings),
  };
}
