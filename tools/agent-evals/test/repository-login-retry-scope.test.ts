import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { taskSchema } from '../src/adapters/evaluation-config.ts';
import { gradeDiffScope } from '../src/domain/acceptance-graders.ts';
import type { TrialEvidence } from '../src/domain/types.ts';

test('retry task permits a dedicated regression test while unrelated changes still fail scope', async () => {
  const task = taskSchema.parse(
    JSON.parse(
      await readFile(
        new URL('../../../evals/tasks/repository-login-retry.json', import.meta.url),
        'utf8',
      ),
    ),
  );
  assert.equal(task.version, '2');
  const evidence: TrialEvidence = {
    task,
    variant: 'enabled',
    localUrl: 'http://127.0.0.1:1234',
    events: [],
    artifacts: [],
    changedFiles: [task.targetFile, 'e2e/admin-login-retry.spec.ts'],
    patch: {
      id: 'changes',
      path: 'changes.patch',
      content: 'Offline fixture change set',
      sha256: 'a'.repeat(64),
      observedBy: 'evaluator',
    },
    agent: {
      status: 'completed',
      startedAt: '2026-09-27T00:00:00Z',
      endedAt: '2026-09-27T00:00:01Z',
      exitCode: 0,
      signal: null,
      model: null,
      thinkingLevel: null,
      events: [],
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        estimatedCostUsd: 0,
        costSource: 'Offline authored fixture',
      },
    },
  };
  assert.equal(gradeDiffScope(evidence).verdict, 'pass');
  const unrelated = gradeDiffScope({
    ...evidence,
    changedFiles: [...evidence.changedFiles!, 'app/admin/guests/page.tsx'],
  });
  assert.equal(unrelated.verdict, 'fail');
  assert.match(unrelated.reason, /app\/admin\/guests\/page.tsx/);
});
