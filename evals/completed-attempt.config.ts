import type { EvalConfig } from 'agent-evals';
import config, { createJudge } from './config.ts';
import { falsifiableHypothesis, relevantProbe } from './views/diagnosis/index.ts';
import { completedDiagnosis } from './views/completed-diagnosis/index.ts';
import { finalValidation } from './views/validation-history/index.ts';

/** Regrade the first completed diagnostic attempt, with the sharper hypothesis question. */
export default {
  ...config,
  suite: {
    ...config.suite,
    graders: [
      {
        ...falsifiableHypothesis,
        version: 2,
        view: completedDiagnosis,
        question:
          'Before the probe, did the visible hypothesis predict a concrete observable result whose opposite would disprove it? A repair plan or a conclusion stated after the result is insufficient.',
      },
      { ...relevantProbe, view: completedDiagnosis },
      finalValidation,
    ],
  },
  createJudge: () => createJudge({ maxStateChars: 30_000 }),
} satisfies EvalConfig;
