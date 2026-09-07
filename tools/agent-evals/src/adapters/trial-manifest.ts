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
  const sourceHashes = sources.map((source) => ({ path: source.path, sha256: source.sha256 }));
  const comparisonEligible =
    [...pi.resources.instructions, ...pi.resources.systemPrompts].reduce(
      (count, source) => count + Number(source.pilotRuleOccurrences ?? 0),
      0,
    ) === 1;
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();
  const [fixtureHash, repositorySkillsHash, harnessHash, instruction, lockfile] = await Promise.all(
    [
      treeHash(path.join(repo, 'evals/fixtures', task.fixture)),
      treeHash(path.join(repo, '.agents/skills')),
      treeHash(path.join(repo, 'tools/agent-evals/src')),
      readFile(path.join(repo, 'AGENTS.md'), 'utf8'),
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
      profileHash: hashText(JSON.stringify(profile)),
      instructionTemplateHash: hashText(instruction),
      dependencyLockHash: hashText(lockfile),
      rubric: { id: task.rubric, sha256: hashText(rubric) },
      sourceProfile: {
        cwd: pi.resources.cwd,
        projectTrusted: pi.resources.projectTrusted,
        instructions: pi.resources.instructions.map(({ path, scope }) => ({ path, scope })),
        skills: pi.resources.skills.map(({ path, name, scope, source, origin }) => ({
          path,
          name,
          scope,
          source,
          origin,
        })),
        systemPrompts: pi.resources.systemPrompts.map(({ path, scope }) => ({ path, scope })),
      },
      piVersion: pi.version,
      model: pi.defaults,
      sourceHashes,
    },
  };
}
