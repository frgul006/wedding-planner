import type { EvalConfig } from 'agent-evals';
import config, { createJudge } from './config.ts';
import {
  completedDiagnosis,
  falsifiableHypothesis,
  relevantProbe,
  finalValidation,
} from './views/diagnosis.ts';

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
