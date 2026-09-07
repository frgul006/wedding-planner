import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { runTrial } from '../../application/run-trial.ts';
import {
  AiSdkRubricGrader,
  checkGraderModel,
  type RubricResult,
} from '../../adapters/ai-sdk-grader.ts';
import { FileRunStore, hash } from '../../adapters/file-run-store.ts';
import { inspectPi } from '../../adapters/pi-inspection.ts';
import { PiRpcRunner } from '../../adapters/pi-rpc.ts';
import { loadGraderKey } from '../../adapters/secrets.ts';
import { prepareTrialEnvironment } from '../../adapters/trial-environment.ts';
import { trialInvariants } from '../../adapters/trial-manifest.ts';
import { gradeTrial, observeSkills } from '../../domain/deterministic-graders.ts';
import { renderReport } from '../../domain/report.ts';
import { timestampId, type CommandContext } from '../context.ts';
import { createTrialPlan, type TrialPlan } from '../live-plan.ts';
import { formatDuration, trialSummary } from '../output.ts';

function preview(plan: TrialPlan) {
  return {
    task: plan.task,
    variant: plan.variant,
    profile: plan.profile,
    fixture: plan.fixtureDirectory,
    useGrader: plan.useGrader,
    retryOf: plan.retryOf,
    budget: {
      appliesTo:
        plan.profile.agentBilling === 'subscription'
          ? 'direct API calls only; verified subscription Pi excluded'
          : 'Pi and grader API calls',
      reservedEstimateUsd: plan.budget.reservedUsd,
      limitUsd: plan.budget.limitUsd,
      providerEnforced: false,
    },
  };
}

function previewText(plan: TrialPlan): string {
  const profile = plan.profile;
  return `Ready to run · ${plan.task.id} · instruction ${plan.variant}

${plan.task.prompt}

Fixture: ${plan.task.fixture}
Pi: saved native model/auth · ${profile.agentBilling} billing
Bounds: ${profile.maxAgentTokens.toLocaleString('en-US')} observed tokens · ${formatDuration(profile.runtimeMs)} · 0 automatic retries
API grader: ${plan.useGrader ? `${profile.grader.model} · at most ${profile.grader.maxOutputTokens} output tokens` : 'disabled'}
API reservation: $${plan.budget.reservedUsd.toFixed(6)} of $${plan.budget.limitUsd} estimated allowance

Dry run only. No Pi, API or browser calls were made.
Next: remove --dry-run to start this configuration.`;
}

export async function runCommand(context: CommandContext): Promise<number> {
  const { repo, request, output } = context;
  const plan = await createTrialPlan(context);
  if (request.values['dry-run']) {
    output.result({ dryRun: true, ...preview(plan) }, previewText(plan));
    return 0;
  }
  const key = plan.useGrader ? await loadGraderKey(plan.envFile) : '';
  const availability = key
    ? await checkGraderModel(key, plan.profile.grader.model, context.signal)
    : null;
  const pi = await output.during('Checking native Pi configuration…', () =>
    inspectPi({ cwd: repo }),
  );
  const settings = z
    .object({ provider: z.string(), model: z.string(), thinkingLevel: z.string() })
    .parse(pi.defaults);
  if (
    plan.profile.agentBilling === 'subscription' &&
    (settings.provider !== 'openai-codex' || pi.authentication.type !== 'oauth')
  ) {
    throw new Error(
      'Subscription profile requires verified openai-codex OAuth. Choose an API billing profile for other authentication.',
    );
  }
  const metadata = await trialInvariants(repo, plan.task, plan.profile, pi, plan.rubric);
  const id = `smoke-${plan.task.id}-${plan.variant}-${timestampId()}`;
  const store = new FileRunStore(path.join(repo, 'evals/runs', id), [key]);
  await store.initialize();
  await store.save('inspection.json', pi);
  output.progress(`${plan.task.id} · ${settings.provider}/${settings.model} · ${settings.thinkingLevel}
Pi bounds: ${plan.profile.maxAgentTokens.toLocaleString('en-US')} tokens / ${formatDuration(plan.profile.runtimeMs)}. API reservation: $${plan.budget.reservedUsd.toFixed(6)}.`);
  const runner = new PiRpcRunner({ requiredExtensionCommand: 'eval-sandbox-ready-v1' });
  const result = await runTrial(
    {
      id,
      signal: context.signal,
      task: plan.task,
      variant: plan.variant,
      executable: pi.executable,
      runtimeMs: plan.profile.runtimeMs,
      maxTokens: plan.profile.maxAgentTokens,
      maxEstimatedCostUsd: plan.profile.maxAgentEstimatedCostUsd,
      expectedModel: {
        provider: settings.provider,
        id: settings.model,
        thinkingLevel: settings.thinkingLevel,
      },
      manifest: {
        ...metadata,
        variant: plan.variant,
        profile: plan.profile,
        retryOf: plan.retryOf,
        budget: {
          ...preview(plan).budget,
          agentBilling: plan.profile.agentBilling,
          concurrency: 1,
        },
        graderAvailability: availability,
        rubric: { id: plan.task.rubric, version: '1', sha256: hash(plan.rubric) },
        harnessVersion: '0.2.0',
      },
    },
    {
      environment: {
        prepare: (task, variant, trialId) =>
          output.during('Preparing isolated fixture and validating local tools…', () =>
            prepareTrialEnvironment({
              sourceRepo: repo,
              signal: context.signal,
              task,
              variant,
              id: trialId,
              fixtureDir: plan.fixtureDirectory,
              pi: { ...pi, defaults: settings },
              runtimeMs: plan.profile.runtimeMs,
            }),
          ),
      },
      agent: { run: (request) => output.during('Running native Pi…', () => runner.run(request)) },
      grader: {
        async grade(evidence) {
          output.progress('Grading captured behavior…');
          return gradeTrial(evidence);
        },
      },
      store,
    },
  );
  let semantic: RubricResult | undefined;
  if (key) {
    semantic = await output.during(`Grading task clarity with ${plan.profile.grader.model}…`, () =>
      new AiSdkRubricGrader(key, plan.profile.grader, plan.rubric).evaluate(
        result.evidence,
        context.signal,
      ),
    );
    result.grades.push(semantic.grade);
    await store.save('semantic.json', semantic);
  }
  await saveFinalResults(store, result, semantic);
  const report = path.join(store.directory, 'report.md');
  output.result(
    {
      id,
      status: result.evidence.agent.status,
      grades: result.grades,
      agentUsage: result.evidence.agent.usage,
      graderUsage: semantic?.usage ?? null,
      report,
    },
    trialSummary(
      result.evidence,
      result.grades,
      report,
      semantic ? semantic.usage.estimatedCostUsd : 'not-run',
    ),
  );
  return result.evidence.agent.status !== 'completed' ||
    result.grades.some((grade) => ['fail', 'unknown'].includes(grade.verdict)) ||
    semantic?.status === 'grader_error'
    ? 2
    : 0;
}

async function saveFinalResults(
  store: FileRunStore,
  result: Awaited<ReturnType<typeof runTrial>>,
  semantic?: RubricResult,
): Promise<void> {
  await store.save('manifest.json', {
    ...result.manifest,
    graderUsage: semantic?.usage ?? null,
    graderStatus: semantic?.status ?? 'not-run',
  });
  await store.save('grades.json', result.grades);
  await store.save('skills.json', observeSkills(result.evidence));
  const files = await readdir(store.directory);
  await store.save(
    'report.md',
    renderReport(result.manifest.id, result.evidence, result.grades, semantic, {
      availableFiles: files,
    }),
  );
  const sealedFiles = [
    'manifest.json',
    'evidence.json',
    'grades.json',
    'inspection.json',
    'report.md',
    'transcript.jsonl',
    'skills.json',
  ];
  if (files.includes('environment.json')) sealedFiles.push('environment.json');
  if (semantic) sealedFiles.push('semantic.json');
  await store.seal(sealedFiles);
}
