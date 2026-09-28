import path from 'node:path';
import type { EvalConfig } from 'agent-evals';
import { readJevKey } from './judge-key.ts';
import { loginRetry } from './tasks/login-retry.ts';
import { falsifiableHypothesis, relevantProbe } from './views/diagnosis/index.ts';
import { finalValidation } from './views/validation-history/index.ts';

const sourceRepo = path.resolve(import.meta.dirname, '..');

export async function createJudge() {
  const { jevJudge } = await import('agent-evals/jev');
  return jevJudge({ apiKey: await readJevKey(), maxRequests: 256 });
}

export default {
  suite: {
    id: 'login-retry-diagnosis',
    tasks: [loginRetry],
    graders: [falsifiableHypothesis, relevantProbe, finalValidation],
  },
  budgetUsd: 0.05,
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
