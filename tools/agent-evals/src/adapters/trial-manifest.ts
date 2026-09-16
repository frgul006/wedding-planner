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

type PiInspection = Awaited<ReturnType<typeof inspectPi>>;

/** Reproducibility metadata is adapter data, assembled before an agent can edit the fixture. */
export async function trialInvariants(
  repo: string,
  task: TaskDefinition,
  profile: EvaluationProfile,
  pi: PiInspection,
  rubric: string,
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
  const comparisonEligible =
    [...pi.resources.instructions, ...pi.resources.systemPrompts].reduce(
      (count, source) => count + Number(source.pilotRuleOccurrences ?? 0),
      0,
    ) === 1;
  const revision = execFileSync('git', ['rev-parse', task.repository?.revision ?? 'HEAD'], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();
  const [fixtureHash, repositorySkillsHash, harnessHash, instruction, lockfile] = await Promise.all(
    [
      task.environment === 'repository'
        ? Promise.resolve(revision)
        : treeHash(path.join(repo, 'evals/fixtures', task.fixture)),
      treeHash(path.join(pi.resources.cwd, '.agents/skills')),
      treeHash(path.join(repo, 'tools/agent-evals/src')),
      readFile(path.join(pi.resources.cwd, 'AGENTS.md'), 'utf8'),
      readFile(path.join(repo, 'pnpm-lock.yaml'), 'utf8'),
    ],
  );
  return {
    comparisonEligible,
    invariants: {
      revision,
      fixtureHash,
      repositorySkillsHash,
      harnessHash,
      taskHash: hashText(JSON.stringify(task)),
      profileHash: hashText(
        JSON.stringify({ ...profile, id: undefined, pi: undefined, harness: undefined }),
      ),
      agentConfiguration: {
        adapter: profile.harness,
        runtime: profile.pi.runtime,
        settings: isolatedPiSettings(pi.conversationSettings, profile.pi.runtime),
        extensionPolicy: 'disabled',
        tools: ['read', 'bash', 'edit', 'write'],
      },
      instructionTemplateHash: hashText(instruction),
      dependencyLockHash: hashText(lockfile),
      rubric: { id: task.rubric, sha256: hashText(rubric) },
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
      model: pi.defaults,
      sourceHashes,
    },
  };
}
