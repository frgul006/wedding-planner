import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  buildReviewBundle,
  writeReviewBundle,
  type ReviewTrial,
} from '../src/adapters/review-bundle.ts';
import { hash } from '../src/adapters/file-run-store.ts';

test('shareable bundle excludes raw strings and unknown fields while preserving auditable facts', async () => {
  const privateText = 'synthetic-private-material-do-not-export';
  const trial: ReviewTrial = {
    id: 'trial-one',
    integrityHash: 'a'.repeat(64),
    grades: [
      {
        grader: 'target-outcome',
        version: '1',
        verdict: 'pass',
        reason: privateText,
        evidenceRefs: ['a-target'],
      },
    ],
    gradingResults: [
      {
        grader: 'target-outcome',
        version: '1',
        status: 'completed',
        grades: [],
        metadata: { privateText },
      },
    ],
    evidence: {
      task: {
        id: 'task',
        version: '1',
        kind: 'docs',
        prompt: privateText,
        targetFile: 'README.md',
        expectedText: privateText,
        flowPath: '/',
      },
      variant: 'enabled',
      localUrl: 'http://127.0.0.1:1234',
      agent: {
        status: 'completed',
        startedAt: '',
        endedAt: '',
        exitCode: 0,
        signal: null,
        error: privateText,
        model: {
          provider: 'test',
          id: '/Users/private/model',
          headers: { Authorization: privateText },
        },
        thinkingLevel: 'low',
        events: [],
        usage: {
          inputTokens: 1,
          outputTokens: 2,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          estimatedCostUsd: 0,
          costSource: privateText,
        },
      },
      artifacts: [
        {
          id: 'a-target',
          path: '/Users/private/README.md',
          content: privateText,
          sha256: 'b'.repeat(64),
          observedBy: 'evaluator',
        },
      ],
      events: [
        {
          id: 'e1',
          sequence: 1,
          timestamp: '',
          actor: 'agent',
          kind: 'pi',
          data: { raw: privateText },
          observation: {
            type: 'tool_completed',
            callId: 'call',
            success: true,
            text: privateText,
            textSha256: 'c'.repeat(64),
            truncated: false,
            receipt: {
              kind: 'file-read',
              path: '/Users/private/README.md',
              sha256: 'd'.repeat(64),
            },
          },
        },
      ],
    },
  };
  const budget = { limitUsd: 1, reservedEstimateUsd: 0, privateText };
  const bundle = buildReviewBundle(
    'experiment-one',
    [trial],
    [{ pair: 1, eligible: true, mismatchFields: [] }],
    budget,
    0,
  );
  const encoded = JSON.stringify(bundle);
  assert.equal(encoded.includes(privateText), false);
  assert.equal(encoded.includes('/Users/'), false);
  assert.equal(encoded.includes('Authorization'), false);
  assert.equal(bundle.trials[0].toolObservations[0].success, true);
  assert.equal(bundle.trials[0].artifacts[0].sha256, 'b'.repeat(64));
  assert.equal(bundle.trials[0].originalIntegrityHash, 'a'.repeat(64));
  const unknown = structuredClone(trial);
  unknown.evidence.agent.usage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    estimatedCostUsd: null,
    costSource: 'Unknown: no successful usage response',
  };
  const unknownBundle = buildReviewBundle(
    'experiment-unknown',
    [unknown],
    [],
    { limitUsd: 1, reservedEstimateUsd: 0.01, observedApiEstimateUsd: null },
    0,
  );
  assert.equal(unknownBundle.trials[0].agentUsage.inputTokens, null);
  assert.equal(unknownBundle.trials[0].agentUsage.outputTokens, null);
  assert.equal(unknownBundle.budget.observedApiEstimateUsd, null);
  const directory = await mkdtemp(join(tmpdir(), 'eval-review-bundle-'));
  try {
    await writeReviewBundle(directory, bundle);
    const seal = JSON.parse(await readFile(join(directory, 'integrity.json'), 'utf8'));
    for (const [name, digest] of Object.entries(seal.files)) {
      const content = await readFile(join(directory, name), 'utf8');
      assert.equal(hash(content), digest);
      assert.equal(content.includes(privateText), false);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
