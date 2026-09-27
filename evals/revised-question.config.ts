import type { EvalConfig } from 'agent-evals';
import config from './config.ts';

/** Regrade the default evidence with a more specific falsifiable-hypothesis question. */
export default {
  ...config,
  suite: {
    ...config.suite,
    graders: config.suite.graders.map((grader) =>
      grader.id === 'falsifiable-hypothesis'
        ? {
            ...grader,
            version: 3,
            question:
              'Before the probe, did the visible hypothesis predict a concrete observable result whose opposite would disprove it? A repair plan or a conclusion stated after the result is insufficient.',
          }
        : grader,
    ),
  },
} satisfies EvalConfig;
