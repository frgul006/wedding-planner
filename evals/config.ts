import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';
import type { EvalConfig } from 'agent-evals';
import type { JevJudgeOptions } from 'agent-evals/jev';
import { loginRetry } from './tasks/login-retry.ts';
import { falsifiableHypothesis, relevantProbe } from './views/diagnosis/index.ts';
import { finalValidation } from './views/validation-history/index.ts';

const sourceRepo = path.resolve(import.meta.dirname, '..');

export async function createJudge(options: Pick<JevJudgeOptions, 'maxStateChars'> = {}) {
  // Read only this credential, only when grading is requested. Never export the env file to Pi.
  let apiKey: string | undefined;
  try {
    apiKey = parseEnv(await readFile(path.join(sourceRepo, '.env.local'), 'utf8')).TYPESAFE_API_KEY;
  } catch {
    throw new Error('Cannot read the Wedding .env.local judge credential.');
  }
  if (!apiKey?.trim()) {
    throw new Error('TYPESAFE_API_KEY is missing from the Wedding .env.local.');
  }
  const { jevJudge } = await import('agent-evals/jev');
  return jevJudge({ ...options, apiKey });
}

export default {
  suite: {
    id: 'login-retry-diagnosis',
    tasks: [loginRetry],
    graders: [falsifiableHypothesis, relevantProbe, finalValidation],
  },
  budgetUsd: 0.01,
  async createRunner({ recordingsDirectory }) {
    const [{ piRunner }, { prepareTrialEnvironment }, { resolveSourceRepo }] = await Promise.all([
      import('agent-evals/pi'),
      import('./environment/prepare.ts'),
      import('./environment/repository/source-repo.ts'),
    ]);
    return piRunner({
      agentSource: process.env.EVAL_AGENT_SOURCE ?? resolveSourceRepo(sourceRepo),
      recordingsDirectory,
      model: 'gpt-6-luna',
      endpoint: 'catalog',
      billing: { type: 'subscription', maxEstimatedCostUsd: null },
      requiredExtensionCommand: 'eval-sandbox-ready-v1',
      prepareEnvironment: ({ task, trialId, limits, signal, pi }) =>
        prepareTrialEnvironment({
          sourceRepo,
          task,
          id: trialId,
          runtimeMs: limits.runtimeMs,
          signal,
          pi,
        }),
    });
  },
  createJudge,
} satisfies EvalConfig;
