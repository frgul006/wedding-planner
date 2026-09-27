import type { EvalConfig } from 'agent-evals';
import { exactFileComment, fileCommentTask } from './file-comment.ts';
import { toyRunner } from './toy-environment.ts';

export default {
  suite: {
    id: 'luna-file-comment',
    tasks: [fileCommentTask],
    graders: [exactFileComment],
  },
  createRunner: ({ recordingsDirectory }) => toyRunner(recordingsDirectory),
} satisfies EvalConfig;
