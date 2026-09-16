import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AiSdkRubricGrader,
  checkGraderModel,
  semanticEvidence,
  type RubricConfig,
} from '../src/adapters/ai-sdk-grader.ts';
import type { TrialEvidence } from '../src/domain/types.ts';

const config: RubricConfig = {
  model: 'gpt-5.6-luna',
  maxOutputTokens: 800,
  maxInputChars: 18_000,
  timeoutMs: 20_000,
  inputPerMillion: 0.2,
  outputPerMillion: 1.2,
  pricingSource: 'offline test prices',
};
const trial: TrialEvidence = {
  task: {
    id: 'docs',
    version: '1',
    kind: 'docs',
    prompt: 'Document local startup',
    targetFile: 'README.md',
    expectedText: 'pnpm dev',
    flowPath: '/',
  },
  variant: 'enabled',
  localUrl: 'http://127.0.0.1:1234',
  events: [],
  artifacts: [
    {
      id: 'target',
      path: 'README.md',
      content: 'Run pnpm dev to start the local server.',
      sha256: 'test',
      observedBy: 'evaluator',
    },
  ],
  agent: {
    status: 'completed',
    startedAt: '',
    endedAt: '',
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
      costSource: 'offline fixture',
    },
  },
};

function response(text: string): Response {
  return new Response(
    JSON.stringify({
      id: 'offline-response',
      model: config.model,
      created_at: 1_800_000_000,
      output: [
        {
          type: 'message',
          id: 'message-1',
          role: 'assistant',
          content: [{ type: 'output_text', text, annotations: [] }],
        },
      ],
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        input_tokens_details: { cached_tokens: 30 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}
const validGrade = {
  verdict: 'pass',
  reason: 'The startup command is documented.',
  evidence: [{ id: 'target', quote: 'pnpm dev' }],
};

test('semantic evidence includes independent before, after and complete patch sources', () => {
  const enriched = {
    ...trial,
    beforeArtifacts: [
      { ...trial.artifacts[0], id: 'before-target', content: 'Old startup guidance' },
    ],
    patch: {
      ...trial.artifacts[0],
      id: 'final-patch',
      path: 'changes.patch',
      content: '-Old startup guidance\n+Run pnpm dev',
    },
  };
  const sources = semanticEvidence(enriched);
  assert.deepEqual(
    sources.map(({ id, stage }) => [id, stage]),
    [
      ['before-target', 'before'],
      ['target', 'after'],
      ['final-patch', 'patch'],
    ],
  );
  assert.equal(sources[0].content, 'Old startup guidance');
  assert.match(sources[2].content, /Old startup guidance/);
});

test('the Grader port retains semantic usage and citation metadata', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => response(JSON.stringify(validGrade)));
  const result = await new AiSdkRubricGrader(
    'synthetic-test-key',
    config,
    'Grade documentation.',
  ).grade(trial);
  assert.equal(result.grader, 'semantic-task-clarity');
  assert.equal(result.status, 'completed');
  assert.equal(result.grades[0].verdict, 'pass');
  assert.equal(result.usage?.estimatedCostUsd, 0.000044);
  assert.deepEqual(result.metadata?.citations, validGrade.evidence);
  assert.equal(result.metadata?.model, config.model);
});

test('semantic grading uses structured direct OpenAI output, bounded tokens, no storage and verified citations', async (context) => {
  let requests = 0;
  context.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    requests++;
    assert.equal(String(input), 'https://api.openai.com/v1/responses');
    const request = JSON.parse(String(init?.body));
    assert.equal(request.model, config.model);
    assert.equal(request.max_output_tokens, config.maxOutputTokens);
    assert.equal(request.store, false);
    assert.equal(request.reasoning.effort, 'none');
    assert.equal(request.text.format.type, 'json_schema');
    assert.equal(request.tools, undefined);
    assert.ok(init?.signal);
    return response(JSON.stringify(validGrade));
  });
  const result = await new AiSdkRubricGrader(
    'synthetic-test-key',
    config,
    'Grade the documentation.',
  ).evaluate(trial);
  assert.equal(requests, 1);
  assert.equal(result.status, 'completed');
  assert.equal(result.grade.verdict, 'pass');
  assert.deepEqual(result.citations, validGrade.evidence);
  assert.equal(result.usage.inputTokens, 100);
  assert.equal(result.usage.outputTokens, 20);
  assert.equal(result.usage.cacheReadTokens, 30);
  assert.equal(result.usage.estimatedCostUsd, 0.000044);
});

test('oversized semantic input fails before any network dispatch', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => assert.fail('No API call is permitted'));
  const result = await new AiSdkRubricGrader(
    'synthetic-test-key',
    { ...config, maxInputChars: 10 },
    'Grade documentation.',
  ).evaluate(trial);
  assert.equal(result.status, 'grader_error');
  assert.equal(result.grade.verdict, 'unknown');
  assert.match(result.grade.reason, /not dispatched/);
  assert.equal(result.usage.estimatedCostUsd, 0);
});

test('an unverifiable semantic citation produces unknown while retaining charged usage', async (context) => {
  context.mock.method(globalThis, 'fetch', async () =>
    response(
      JSON.stringify({ ...validGrade, evidence: [{ id: 'target', quote: 'fabricated text' }] }),
    ),
  );
  const result = await new AiSdkRubricGrader(
    'synthetic-test-key',
    config,
    'Grade documentation.',
  ).evaluate(trial);
  assert.equal(result.status, 'grader_error');
  assert.equal(result.grade.verdict, 'unknown');
  assert.match(result.grade.reason, /unverifiable evidence/);
  assert.equal(result.usage.estimatedCostUsd, 0.000044);
  assert.deepEqual(result.citations, []);
});

for (const output of [
  'invalid JSON',
  JSON.stringify({ verdict: 'invented', reason: 'Invalid schema', evidence: [] }),
]) {
  test(`malformed structured output retains known usage: ${output.startsWith('{') ? 'schema' : 'JSON'}`, async (context) => {
    let requests = 0;
    context.mock.method(globalThis, 'fetch', async () => {
      requests++;
      return response(output);
    });
    const result = await new AiSdkRubricGrader(
      'synthetic-test-key',
      config,
      'Grade documentation.',
    ).evaluate(trial);
    assert.equal(result.status, 'grader_error');
    assert.equal(result.grade.verdict, 'unknown');
    assert.equal(result.usage.estimatedCostUsd, 0.000044);
    assert.equal(requests, 1);
  });
}

test('a retryable provider error has one attempt and reports unknown usage without falling back', async (context) => {
  let requests = 0;
  context.mock.method(globalThis, 'fetch', async () => {
    requests++;
    return new Response(
      JSON.stringify({ error: { message: 'Temporary test failure', type: 'server_error' } }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  });
  const result = await new AiSdkRubricGrader(
    'synthetic-test-key',
    config,
    'Grade documentation.',
  ).evaluate(trial);
  assert.equal(requests, 1);
  assert.equal(result.model, config.model);
  assert.equal(result.status, 'grader_error');
  assert.equal(result.grade.verdict, 'unknown');
  assert.equal(result.usage.estimatedCostUsd, null);
});

test('cancellation before API dispatch costs zero and skips model availability requests', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => assert.fail('No API call is permitted'));
  const controller = new AbortController();
  controller.abort();
  const result = await new AiSdkRubricGrader('synthetic-test-key', config, 'Grade docs.').evaluate(
    trial,
    controller.signal,
  );
  assert.equal(result.status, 'cancelled');
  assert.equal(result.grade.verdict, 'unknown');
  assert.equal(result.usage.estimatedCostUsd, 0);
  assert.equal(result.usage.costSource, 'No API request dispatched');
  await assert.rejects(checkGraderModel('synthetic-test-key', config.model, controller.signal), {
    name: 'AbortError',
  });
  assert.equal(trial.agent.status, 'completed');
});

test('cancellation aborts an in-flight semantic request and keeps unreported cost unknown', async (context) => {
  const controller = new AbortController();
  let requests = 0;
  context.mock.method(
    globalThis,
    'fetch',
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests++;
      return new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
        controller.abort();
      });
    },
  );
  const result = await new AiSdkRubricGrader('synthetic-test-key', config, 'Grade docs.').evaluate(
    trial,
    controller.signal,
  );
  assert.equal(requests, 1);
  assert.equal(result.status, 'cancelled');
  assert.equal(result.grade.verdict, 'unknown');
  assert.equal(result.usage.estimatedCostUsd, null);
  assert.equal(trial.agent.status, 'completed');
});
