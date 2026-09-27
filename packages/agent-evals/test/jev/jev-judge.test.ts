import assert from 'node:assert/strict';
import test from 'node:test';
import type { Fetch } from '@typesafe-ai/sdk';
import { JEV_MODEL, jevJudge } from '../../src/adapters/jev/index.ts';
import { canonicalJson } from '../../src/core/serialization.ts';
import { JudgePreparationError, JudgeExecutionError } from '../../src/core/grading/judge-errors.ts';
import type { JudgmentJob, JudgeRequest } from '../../src/core/types.ts';

const API_KEY = 'synthetic-typesafe-test-credential';

function job(id = 'diagnosis'): JudgmentJob {
  return {
    id,
    grader: { id, version: '1' },
    question: 'Does the observed reproduction establish the reported failure?',
    rubric: {
      pass: 'An observed reproduction establishes the reported failure.',
      fail: 'The observed reproduction contradicts the reported failure.',
      unknown: 'The reproduction evidence is absent or inconclusive.',
    },
    evidence: {
      id: 'diagnosis/attempt',
      data: { reproduction: { observed: true, outcome: 'Guest list is empty.' } },
      scope: 'Agent observations before the first edit.',
      sourceRefs: ['event:4'],
      coverage: { complete: true, gaps: [] },
      omissions: ['Later observations excluded.'],
      applicability: 'applicable',
      view: { id: 'diagnosis', version: '1' },
      serializationVersion: 'canonical-json-v1',
      contentHash: 'source-hash',
    },
  };
}

function answer() {
  return {
    type: 'choice',
    choice: 'pass',
    confidence: 0.7,
    probabilities: { pass: 0.8, fail: 0.15, unknown: 0.05 },
  };
}

function result(ids = ['diagnosis']) {
  return {
    model: JEV_MODEL,
    answers: Object.fromEntries(ids.map((id) => [id, answer()])),
    usage: { input_tokens: 500, output_tokens: 20 },
  };
}

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function prepared(fetch: Fetch = async () => response(result())) {
  const judge = jevJudge({ apiKey: API_KEY, fetch });
  const [request] = await judge.prepare([job()]);
  return { judge, request };
}

test('Jev batches questions with identical canonical state and preserves exact credential-free dispatch', async () => {
  let calls = 0;
  let saved: JudgeRequest;
  const judge = jevJudge({
    apiKey: API_KEY,
    fetch: async (url, init) => {
      calls++;
      assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
      assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${API_KEY}`);
      assert.equal(init?.method, 'POST');
      assert.equal(init?.body, canonicalJson(saved.body));
      assert.ok(init?.signal);
      return response(result(['diagnosis', 'cause']));
    },
  });
  const other = job('cause');
  other.evidence.id = 'same-content-different-id';
  other.evidence.contentHash = 'different-tracking-hash';
  other.question = 'Does the agent connect the failure to a specific cause?';
  const [request] = await judge.prepare([job(), other]);
  saved = request;
  assert.equal(calls, 0, 'preparation performs no provider calls');
  assert.deepEqual(request.jobIds, ['diagnosis', 'cause']);
  assert.deepEqual(Object.keys(request.body.questions as object), ['cause', 'diagnosis']);
  assert.equal('questionJobs' in request.metadata, false);
  assert.equal('evidenceIds' in request.metadata, false);
  assert.deepEqual((request.metadata.jobDescriptors as unknown[])[0], {
    jobId: 'diagnosis',
    grader: { id: 'diagnosis', version: '1' },
    evidenceId: 'diagnosis/attempt',
    evidenceHash: 'source-hash',
  });
  assert.equal(request.body.model, JEV_MODEL);
  assert.equal(request.metadata.maxRetries, 0);
  assert.equal(request.metadata.serializationVersion, 'canonical-json-v1');
  assert.ok(request.reservedCostUsd > (500 * 0.042) / 1_000_000);
  assert.ok(!JSON.stringify(request).includes(API_KEY));
  const body = request.body as {
    state: Record<string, unknown>;
    questions: Record<string, unknown>;
  };
  assert.deepEqual(body.state.coverage, { complete: true, gaps: [] });
  assert.deepEqual(body.state.sourceRefs, ['event:4']);
  assert.deepEqual(body.state.view, { id: 'diagnosis', version: '1' });
  assert.match(JSON.stringify(body.questions.diagnosis), /untrusted evidence/);
  const completed = await judge.execute(request);
  assert.equal(calls, 1);
  assert.deepEqual(completed.raw, result(['diagnosis', 'cause']));
  assert.equal(completed.model, JEV_MODEL);
  assert.deepEqual(
    completed.answers.map(({ jobId, verdict }) => [jobId, verdict]),
    [
      ['diagnosis', 'pass'],
      ['cause', 'pass'],
    ],
  );
  assert.deepEqual(completed.answers[0].metadata, {
    probabilities: { pass: 0.8, fail: 0.15, unknown: 0.05 },
    confidence: 0.7,
  });
  assert.deepEqual(completed.usage, {
    inputTokens: 500,
    outputTokens: 20,
    estimatedCostUsd: (500 * 0.042) / 1_000_000,
  });
  assert.equal('reason' in completed.answers[0], false);
  assert.equal('supportingRefs' in completed.answers[0], false);
});

test('Jev batches by canonical contents rather than property insertion order', async () => {
  const first = job();
  first.evidence.data = { a: 1, b: 2 };
  const second = job('other');
  second.evidence.data = { b: 2, a: 1 };
  const judge = jevJudge({ apiKey: API_KEY });
  const requests = await judge.prepare([first, second]);
  assert.equal(requests.length, 1);
  assert.deepEqual(await judge.prepare([first, second]), requests);
});

test('Jev uses literal portable job IDs as question and answer keys through the SDK', async () => {
  const ids = ['j2', 'j1', '__proto__', 'constructor', 'episode/λ:"quoted"'];
  const judge = jevJudge({
    apiKey: API_KEY,
    fetch: async (_, init) => {
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(new Set(Object.keys(body.questions)), new Set(ids));
      return response(result([...ids].reverse()));
    },
  });
  const [request] = await judge.prepare(ids.map((id) => job(id)));
  const completed = await judge.execute(request);
  assert.deepEqual(
    completed.answers.map(({ jobId }) => jobId),
    ids,
  );
});

for (const dimension of [
  'data',
  'scope',
  'sourceRefs',
  'coverage',
  'omissions',
  'view',
  'applicability',
] as const) {
  test(`Jev separates requests when submitted ${dimension} differs`, async () => {
    const other = job('other');
    Object.assign(other.evidence, {
      [dimension]: {
        data: { different: true },
        scope: 'All observations',
        sourceRefs: ['event:5'],
        coverage: { complete: false, gaps: ['Missing output'] },
        omissions: [],
        view: { id: 'diagnosis', version: '2' },
        applicability: 'unknown',
      }[dimension],
    });
    const requests = await jevJudge({ apiKey: API_KEY }).prepare([job(), other]);
    assert.equal(requests.length, 2);
    assert.deepEqual(
      requests.map(({ jobIds }) => jobIds),
      [['diagnosis'], ['other']],
    );
  });
}

test('Jev preparation snapshots mutable input evidence and rubrics', async () => {
  const source = job();
  const judge = jevJudge({ apiKey: API_KEY });
  const [request] = await judge.prepare([source]);
  const before = canonicalJson(request);
  source.evidence.coverage.gaps.push('Added after preparation');
  source.rubric.pass = 'New pass';
  assert.equal(canonicalJson(request), before);
});

test('Jev bounds request count and splits compatible questions without losing any jobs', async () => {
  const jobs = Array.from({ length: 5 }, (_, i) => job(`job-${i}`));
  const judge = jevJudge({ apiKey: API_KEY, maxQuestionsPerRequest: 2, maxRequests: 3 });
  const requests = await judge.prepare(jobs);
  assert.deepEqual(
    requests.map(({ jobIds }) => jobIds.length),
    [2, 2, 1],
  );
  assert.deepEqual(
    requests.flatMap(({ jobIds }) => jobIds),
    jobs.map(({ id }) => id),
  );
  await assert.rejects(
    jevJudge({ apiKey: API_KEY, maxQuestionsPerRequest: 2, maxRequests: 2 }).prepare(jobs),
    /request limit/,
  );
  assert.deepEqual(await judge.prepare([]), []);
});

test('Jev rejects oversize evidence and requests before dispatch rather than truncating', async () => {
  let calls = 0;
  const fetch: Fetch = async () => {
    calls++;
    return response(result());
  };
  await assert.rejects(
    jevJudge({ apiKey: API_KEY, maxStateChars: 20, fetch }).prepare([job()]),
    /character limits/,
  );
  await assert.rejects(
    jevJudge({ apiKey: API_KEY, maxRequestChars: 20, fetch }).prepare([job()]),
    /character limits/,
  );
  const unicode = job();
  unicode.evidence.data = '🌻'.repeat(8_000);
  await assert.rejects(jevJudge({ apiKey: API_KEY, fetch }).prepare([unicode]), /context budget/);
  const manyQuestions = Array.from({ length: 24 }, (_, i) => {
    const next = job(`job-${i}`);
    next.question = 'A'.repeat(3_000);
    return next;
  });
  await assert.rejects(
    jevJudge({ apiKey: API_KEY, maxRequestChars: 200_000, fetch }).prepare(manyQuestions),
    /context budget/,
  );
  assert.equal(calls, 0);
});

test('Jev preparation exposes a portable safe reason for oversize evidence', async () => {
  const judge = jevJudge({ apiKey: API_KEY, maxStateChars: 20 });
  await assert.rejects(judge.prepare([job()]), (error: unknown) => {
    assert.ok(error instanceof JudgePreparationError);
    assert.equal(
      error.message,
      'Jev evidence or request exceeds configured character limits; no content was truncated.',
    );
    assert.equal(error.cause, undefined);
    assert.ok(!JSON.stringify(error).includes(API_KEY));
    return true;
  });
});

test('Jev validates explicit credentials, numeric limits, unique IDs and categorical rubrics', async () => {
  assert.throws(() => jevJudge({ apiKey: ' ' }), /explicit API key/);
  assert.throws(() => jevJudge({ apiKey: API_KEY, maxRequests: Number.NaN }), /positive integers/);
  assert.throws(() => jevJudge({ apiKey: API_KEY, timeoutMs: 0 }), /positive integers/);
  const judge = jevJudge({ apiKey: API_KEY });
  await assert.rejects(judge.prepare([job(), job()]), /unique IDs/);
  const invalid = job();
  invalid.rubric.unknown = '';
  await assert.rejects(judge.prepare([invalid]), /explicit pass, fail, and unknown/);
});

test('Jev blocks accidental credential capture in evidence, questions and valid responses', async () => {
  const source = job();
  source.evidence.data = API_KEY;
  const judge = jevJudge({ apiKey: API_KEY });
  await assert.rejects(judge.prepare([source]), /content containing its API credential/);
  await assert.rejects(judge.prepare([job(API_KEY)]), /content containing its API credential/);
  const question = job();
  question.question = API_KEY;
  await assert.rejects(judge.prepare([question]), /content containing its API credential/);
  const preparedJudge = await prepared(async () =>
    response({ ...result(), unexpectedEcho: API_KEY }),
  );
  await assert.rejects(
    preparedJudge.judge.execute(preparedJudge.request),
    /content containing its API credential/,
  );
});

test('Jev retains its original credential guard when caller options change', async () => {
  const options = {
    apiKey: API_KEY,
    fetch: async (_: unknown, init?: RequestInit) => {
      assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${API_KEY}`);
      return response({ ...result(), echo: { [API_KEY]: API_KEY } });
    },
  };
  const judge = jevJudge(options);
  options.apiKey = 'synthetic-replacement-credential';
  await assert.rejects(judge.prepare([job(API_KEY)]), /content containing its API credential/);
  const [request] = await judge.prepare([job()]);
  await assert.rejects(judge.execute(request), (error: unknown) => {
    assert.ok(error instanceof JudgeExecutionError);
    assert.equal(error.message, 'Jev refused content containing its API credential.');
    assert.deepEqual(error.receivedResponse, { ...result(), echo: { '[REDACTED]': '[REDACTED]' } });
    assert.ok(!JSON.stringify(error).includes(API_KEY));
    return true;
  });
});

test('Jev pinned model, endpoint and disabled logging override ambient SDK settings', async (context) => {
  context.mock.method(console, 'debug', () => assert.fail('SDK logged debug output'));
  context.mock.method(console, 'info', () => assert.fail('SDK logged info output'));
  const original = {
    model: process.env.TYPESAFE_DEFAULT_MODEL,
    base: process.env.TYPESAFE_BASE_URL,
    log: process.env.TYPESAFE_LOG_LEVEL,
  };
  try {
    process.env.TYPESAFE_DEFAULT_MODEL = 'jev-latest';
    process.env.TYPESAFE_BASE_URL = 'https://example.invalid';
    process.env.TYPESAFE_LOG_LEVEL = 'debug';
    const { judge, request } = await prepared(async (url, init) => {
      assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
      assert.equal(JSON.parse(String(init?.body)).model, JEV_MODEL);
      return response(result());
    });
    await judge.execute(request);
  } finally {
    for (const [key, value] of Object.entries({
      TYPESAFE_DEFAULT_MODEL: original.model,
      TYPESAFE_BASE_URL: original.base,
      TYPESAFE_LOG_LEVEL: original.log,
    })) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

for (const status of [401, 429, 500]) {
  test(`Jev HTTP ${status} errors are sanitized and are not retried`, async () => {
    let calls = 0;
    const { judge, request } = await prepared(async () => {
      calls++;
      return response({ message: `${API_KEY} private evidence` }, status);
    });
    await assert.rejects(judge.execute(request), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, `Jev request failed with HTTP ${status}.`);
      assert.equal(error.cause, undefined);
      assert.ok(!error.stack?.includes(API_KEY));
      assert.ok(error instanceof JudgeExecutionError);
      assert.equal(error.receivedResponse, undefined);
      return true;
    });
    assert.equal(calls, 1);
  });
}

test('Jev connection failures redact SDK error details and are not retried', async () => {
  let calls = 0;
  const { judge, request } = await prepared(async () => {
    calls++;
    throw new Error(`${API_KEY} private evidence`);
  });
  await assert.rejects(judge.execute(request), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, 'Jev connection failed.');
    assert.equal(error.cause, undefined);
    assert.ok(error instanceof JudgeExecutionError);
    assert.equal(error.receivedResponse, undefined);
    return true;
  });
  assert.equal(calls, 1);
});

test('Jev cancellation before dispatch does not contact the provider', async () => {
  let calls = 0;
  const { judge, request } = await prepared(async () => {
    calls++;
    return response(result());
  });
  await assert.rejects(judge.execute(request, AbortSignal.abort(API_KEY)), {
    name: 'AbortError',
    message: 'Jev request cancelled.',
  });
  assert.equal(calls, 0);
});

test('Jev passes cancellation to the SDK and drops caller abort details', async () => {
  const controller = new AbortController();
  const { judge, request } = await prepared(async (_, init) => {
    setImmediate(() => controller.abort(API_KEY));
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error(API_KEY)), { once: true });
    });
  });
  await assert.rejects(judge.execute(request, controller.signal), {
    name: 'AbortError',
    message: 'Jev request cancelled.',
  });
});

test('Jev enforces the SDK request timeout without retries', async () => {
  let calls = 0;
  const judge = jevJudge({
    apiKey: API_KEY,
    timeoutMs: 10,
    fetch: async (_, init) => {
      calls++;
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error(API_KEY)), { once: true });
      });
    },
  });
  const [request] = await judge.prepare([job()]);
  await assert.rejects(judge.execute(request), { message: 'Jev request timed out.' });
  assert.equal(calls, 1);
});

const malformedCases: Array<[string, (value: ReturnType<typeof result>) => unknown]> = [
  ['model mismatch', (value) => ({ ...value, model: 'jev-latest' })],
  ['missing answer', (value) => ({ ...value, answers: {} })],
  ['extra answer', (value) => ({ ...value, answers: { ...value.answers, unexpected: answer() } })],
  [
    'wrong primitive',
    (value) => ({ ...value, answers: { diagnosis: { type: 'noul', noul: 0.8 } } }),
  ],
  [
    'invalid choice',
    (value) => ({ ...value, answers: { diagnosis: { ...answer(), choice: 'maybe' } } }),
  ],
  [
    'invalid confidence',
    (value) => ({ ...value, answers: { diagnosis: { ...answer(), confidence: 1.01 } } }),
  ],
  [
    'invalid probability',
    (value) => ({
      ...value,
      answers: { diagnosis: { ...answer(), probabilities: { pass: 1.1, fail: -0.1, unknown: 0 } } },
    }),
  ],
  [
    'unnormalized distribution',
    (value) => ({
      ...value,
      answers: {
        diagnosis: { ...answer(), probabilities: { pass: 0.8, fail: 0.8, unknown: 0.1 } },
      },
    }),
  ],
  [
    'missing distribution key',
    (value) => ({
      ...value,
      answers: { diagnosis: { ...answer(), probabilities: { pass: 0.8, fail: 0.2 } } },
    }),
  ],
  [
    'extra distribution key',
    (value) => ({
      ...value,
      answers: {
        diagnosis: { ...answer(), probabilities: { ...answer().probabilities, extra: 0 } },
      },
    }),
  ],
  [
    'nonmaximal selected choice',
    (value) => ({ ...value, answers: { diagnosis: { ...answer(), choice: 'fail' } } }),
  ],
  ['invalid usage', (value) => ({ ...value, usage: { input_tokens: -1, output_tokens: 0 } })],
  ['missing usage', (value) => ({ ...value, usage: null })],
];
for (const [name, malformed] of malformedCases) {
  test(`Jev rejects and retains a response with ${name}`, async () => {
    const received = malformed(result());
    const { judge, request } = await prepared(async () => response(received));
    await assert.rejects(judge.execute(request), (error: unknown) => {
      assert.ok(error instanceof JudgeExecutionError);
      assert.deepEqual(error.receivedResponse, received);
      assert.equal(error.cause, undefined);
      if (['invalid usage', 'missing usage'].includes(name)) {
        assert.equal(error.observedUsage, undefined);
      } else {
        assert.deepEqual(error.observedUsage, {
          inputTokens: 500,
          outputTokens: 20,
          estimatedCostUsd: name === 'model mismatch' ? null : (500 * 0.042) / 1_000_000,
        });
      }
      return true;
    });
  });
}

test('Jev retains malformed response text only after removing its credential', async () => {
  const { judge, request } = await prepared(async () => new Response(`{ invalid ${API_KEY}`));
  await assert.rejects(judge.execute(request), (error: unknown) => {
    assert.ok(error instanceof JudgeExecutionError);
    assert.equal(error.message, 'Jev request failed or returned malformed data.');
    assert.equal(error.receivedResponse, '{ invalid [REDACTED]');
    assert.equal(error.observedUsage, undefined);
    assert.ok(!JSON.stringify(error).includes(API_KEY));
    return true;
  });
});

test('Jev redacts credential echoes from retained invalid responses including nested keys', async () => {
  const raw = {
    ...result(),
    answers: {},
    echo: { [API_KEY]: [`Bearer ${API_KEY}`, { repeated: `${API_KEY} ${API_KEY}` }] },
  };
  const { judge, request } = await prepared(async () => response(raw));
  await assert.rejects(judge.execute(request), (error: unknown) => {
    assert.ok(error instanceof JudgeExecutionError);
    assert.equal(error.message, 'Jev response has missing or unexpected answer IDs.');
    assert.deepEqual(error.receivedResponse, {
      ...result(),
      answers: {},
      echo: { '[REDACTED]': ['Bearer [REDACTED]', { repeated: '[REDACTED] [REDACTED]' }] },
    });
    assert.deepEqual(error.observedUsage, {
      inputTokens: 500,
      outputTokens: 20,
      estimatedCostUsd: (500 * 0.042) / 1_000_000,
    });
    assert.ok(!JSON.stringify(error).includes(API_KEY));
    assert.ok(!error.stack?.includes(API_KEY));
    return true;
  });
});

test('Jev rejects and redacts credential echoes even when JSON serialization escapes the key', async () => {
  const escapedKey = 'synthetic-secret-with-"quotes"-and-\\slashes';
  const judge = jevJudge({
    apiKey: escapedKey,
    fetch: async () => response({ ...result(), echo: escapedKey }),
  });
  const [request] = await judge.prepare([job()]);
  await assert.rejects(judge.execute(request), (error: unknown) => {
    assert.ok(error instanceof JudgeExecutionError);
    assert.equal(error.message, 'Jev refused content containing its API credential.');
    assert.deepEqual(error.receivedResponse, { ...result(), echo: '[REDACTED]' });
    return true;
  });
});

test('Jev refuses a mutated request or reduced cost reservation before dispatch', async () => {
  let calls = 0;
  const { judge, request } = await prepared(async () => {
    calls++;
    return response(result());
  });
  await assert.rejects(
    judge.execute({ ...request, body: { ...request.body, model: 'jev-latest' } }),
    /integrity check/,
  );
  await assert.rejects(
    judge.execute({ ...request, reservedCostUsd: 0 }),
    /reservation is insufficient/,
  );
  for (const jobIds of [[], ['diagnosis', 'diagnosis'], ['other']]) {
    await assert.rejects(judge.execute({ ...request, jobIds }), /integrity check/);
  }
  assert.equal(calls, 0);
});
