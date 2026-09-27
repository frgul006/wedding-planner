import type { EvalConfig } from 'agent-evals';
import { readJevKey } from '../judge-key.ts';
import { greetingGrader, greetingTask } from './greeting.ts';
import { toyRunner } from './toy-environment.ts';

export default {
  suite: {
    id: 'luna-greeting',
    tasks: [greetingTask],
    graders: [greetingGrader],
  },
  budgetUsd: 0.01,
  createRunner: ({ recordingsDirectory }) => toyRunner(recordingsDirectory),
  async createJudge() {
    const apiKey = await readJevKey();
    const { jevNoulJudge } = await import('agent-evals/jev');
    return jevNoulJudge({ apiKey, thresholds: { pass: 0.8, fail: 0.2 } });
  },
} satisfies EvalConfig;
