import type { View } from '../../src/index.ts';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileStore } from '../../src/adapters/files/index.ts';
import { codeGrader, createEvaluator, modelGrader } from '../../src/index.ts';
import type { Grader } from '../../src/index.ts';

test('invalid grader definitions fail before starting or recording a native attempt', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'eval-definition-admission-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  let attempts = 0;
  const evaluator = createEvaluator({
    store: fileStore(directory),
    runner: {
      async run() {
        attempts++;
        throw new Error('An invalid suite must not start the runner');
      },
    },
  });
  const view = { id: 'same-view', version: 1, prepare: () => [] } satisfies View;
  const grader = codeGrader({
    id: 'check',
    version: 1,
    view,
    check: () => ({ verdict: 'pass' }),
  });
  const invalid: Grader[][] = [
    [grader, grader],
    [grader, { ...grader, id: 'other', view: { ...view } }],
    [
      modelGrader({
        id: 'model',
        version: 1,
        view,
        question: '',
        rubric: { pass: 'Observed', fail: 'Absent', unknown: 'Unavailable' },
      }),
    ],
  ];
  for (const graders of invalid) {
    await assert.rejects(
      evaluator.run({
        id: 'invalid-suite',
        tasks: [{ id: 'task', version: 1, prompt: 'Investigate a bug' }],
        graders,
      }),
      /Grader IDs|shared view object|require a question/,
    );
  }
  assert.equal(attempts, 0);
  assert.deepEqual(await readdir(directory), []);
});
