import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { EvaluationProfile, TaskDefinition } from './evaluation-config.ts';
import { isolatedPiSettings } from './isolation/pi-configuration.ts';

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
  task: TaskDefinition,
  profile: EvaluationProfile,
  conversationSettings: Record<string, unknown>,
) {
  const [harnessHash, lockfile] = await Promise.all([
    treeHash(path.join(repo, 'tools/agent-evals/src')),
    readFile(path.join(repo, 'pnpm-lock.yaml'), 'utf8'),
  ]);
  return {
    revision: task.repository.revision,
    harnessHash,
    taskHash: hashText(JSON.stringify(task)),
    profileHash: hashText(JSON.stringify(profile)),
    dependencyLockHash: hashText(lockfile),
    settings: isolatedPiSettings(conversationSettings),
  };
}
