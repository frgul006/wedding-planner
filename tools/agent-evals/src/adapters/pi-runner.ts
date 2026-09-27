import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Runner } from '../domain/library.ts';
import type { TrialEvidence } from '../domain/types.ts';
import { runTrial } from '../application/run-trial.ts';
import { loadProfile, loadTask, profileSchema } from './evaluation-config.ts';
import { FileRunStore } from './file-run-store.ts';
import { preparePiHarness } from './pi-harness.ts';
import { recordedTrialFromEvidence } from './recorded-trial.ts';

export interface PiRunnerOptions {
  sourceRepo: string;
  agentSource: string;
  profile?: string;
  variant?: 'enabled' | 'disabled';
  runtimeMs?: number;
  maxTokens?: number;
}

/** Native Pi execution only. Preparing views and applying judges belong to the evaluator. */
export function piRunner(
  options: PiRunnerOptions,
  dependencies: { prepareHarness?: typeof preparePiHarness } = {},
): Runner {
  const sourceRepo = resolve(options.sourceRepo);
  const agentSource = resolve(options.agentSource);
  return {
    async run(task, request) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,179}$/.test(request.trialId))
        throw new Error('Use a filesystem-safe trial ID.');
      const definition = await loadTask(sourceRepo, task.id);
      if (String(task.version) !== definition.version || task.prompt !== definition.prompt)
        throw new Error('Pi task version and prompt must match the pinned task catalog entry.');
      const originalProfile = await loadProfile(sourceRepo, options.profile);
      const profile = profileSchema.parse({
        ...originalProfile,
        runtimeMs: options.runtimeMs ?? originalProfile.runtimeMs,
        maxAgentTokens: options.maxTokens ?? originalProfile.maxAgentTokens,
      });
      if (profile.harness !== 'pi') throw new Error('piRunner requires a Pi evaluation profile.');
      const variant = options.variant ?? 'enabled';
      const directory = join(sourceRepo, 'evals/runs', request.trialId);
      await mkdir(join(sourceRepo, 'evals/runs'), { recursive: true, mode: 0o700 });
      // An explicit ID must never replace an earlier attempt.
      await mkdir(directory, { mode: 0o700 });
      const store = new FileRunStore(directory);
      const harness = await (dependencies.prepareHarness ?? preparePiHarness)({
        sourceRepo,
        agentSource,
        task: definition,
        profile,
        rubric: await readFile(
          join(sourceRepo, 'evals/rubrics', `${definition.rubric}.md`),
          'utf8',
        ),
        signal: request.signal,
      });
      await store.save('inspection.json', harness.inspection);
      await runTrial(
        {
          id: request.trialId,
          signal: request.signal,
          task: definition,
          variant,
          runtimeMs: profile.runtimeMs,
          maxTokens: profile.maxAgentTokens,
          maxEstimatedCostUsd: profile.maxAgentEstimatedCostUsd,
          expectedModel: harness.expectedModel,
          manifest: { ...harness.manifest, variant, profile, runner: 'pi-library-v1' },
        },
        { agent: harness.agent, environment: harness.environment, graders: [], store },
      );
      const files = await readdir(directory);
      await store.seal(files.filter((file) => file.endsWith('.json') || file.endsWith('.jsonl')));
      // Saved bytes already passed capture redaction. Never grade the unredacted
      // in-memory object or recover historical context from today's resources.
      const evidence = JSON.parse(
        await readFile(join(directory, 'evidence.json'), 'utf8'),
      ) as TrialEvidence;
      const environment = files.includes('environment.json')
        ? (JSON.parse(await readFile(join(directory, 'environment.json'), 'utf8')) as Record<
            string,
            unknown
          >)
        : {};
      const trial = recordedTrialFromEvidence(request.trialId, evidence, environment);
      trial.task.metadata = { ...trial.task.metadata, ...task.metadata };
      trial.metadata = {
        ...trial.metadata,
        legacyDirectory: directory,
        legacyIntegrity: join(directory, 'integrity.json'),
      };
      return trial;
    },
  };
}
