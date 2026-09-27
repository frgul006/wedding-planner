import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  hashText,
  treeHash,
  type EvaluationProfile,
  type TaskDefinition,
} from './evaluation-config.ts';
import type { inspectPi } from './pi-inspection.ts';
import { isolatedPiSettings } from './isolation/pi-configuration.ts';
import type { PiEndpointSelection } from './pi-endpoint-selection.ts';

type PiInspection = Awaited<ReturnType<typeof inspectPi>>;

/** Reproducibility metadata is adapter data, assembled before an agent can edit the fixture. */
export async function trialInvariants(
  repo: string,
  task: TaskDefinition,
  profile: EvaluationProfile,
  pi: PiInspection,
  effectiveModel: PiInspection['defaults'] = pi.defaults,
  endpointSelection?: PiEndpointSelection,
) {
  const sources = [
    ...pi.resources.instructions,
    ...pi.resources.skills,
    ...pi.resources.systemPrompts,
    ...pi.resources.extensions,
    ...pi.resources.prompts,
  ];
  // Local locations belong in inspection.json, not in cross-checkout equality.
  const sourceIdentity = (file: string) => {
    for (const [root, label] of [
      [pi.resources.cwd, 'project'],
      [pi.agentDir, 'user'],
    ] as const) {
      const relative = path.relative(root, file);
      if (
        relative &&
        relative !== '..' &&
        !relative.startsWith('../') &&
        !path.isAbsolute(relative)
      )
        return `${label}/${relative}`;
    }
    return `ancestor/${path.basename(file)}`;
  };
  const sourceHashes = sources.map((source) => ({
    source: sourceIdentity(source.path),
    sha256: source.sha256,
  }));
  const revision = execFileSync('git', ['rev-parse', task.repository.revision], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();
  const [harnessHash, lockfile] = await Promise.all([
    treeHash(path.join(repo, 'tools/agent-evals/src')),
    readFile(path.join(repo, 'pnpm-lock.yaml'), 'utf8'),
  ]);
  return {
    invariants: {
      revision,
      harnessHash,
      taskHash: hashText(JSON.stringify(task)),
      profileHash: hashText(JSON.stringify(profile)),
      agentConfiguration: {
        adapter: 'pi',
        runtime: profile.pi.runtime,
        ...(endpointSelection ? { endpointPolicy: endpointSelection.policy } : {}),
        settings: isolatedPiSettings(pi.conversationSettings),
        extensionPolicy: 'disabled',
        tools: ['read', 'bash', 'edit', 'write'],
      },
      dependencyLockHash: hashText(lockfile),
      sourceProfile: {
        projectTrusted: pi.resources.projectTrusted,
        instructions: pi.resources.instructions.map(({ path, scope }) => ({
          source: sourceIdentity(path),
          scope,
        })),
        skills: pi.resources.skills.map(({ path, name, scope }) => ({
          source: sourceIdentity(path),
          name,
          scope,
        })),
        systemPrompts: pi.resources.systemPrompts.map(({ path, scope }) => ({
          source: sourceIdentity(path),
          scope,
        })),
      },
      piVersion: pi.version,
      model: {
        ...effectiveModel,
        ...(endpointSelection ? { endpoint: endpointSelection.effective } : {}),
      },
      sourceHashes,
    },
  };
}
