import assert from 'node:assert/strict';
import test from 'node:test';
import { JEV_MODEL, jevJudge, jevNoulJudge } from '../../src/adapters/jev/index.ts';
import { canonicalJson } from '../../src/core/serialization.ts';
import { JudgeExecutionError } from '../../src/core/grading/judge-errors.ts';
import type { JudgmentJob } from '../../src/core/types.ts';

const API_KEY = 'synthetic-noul-test-credential';
const thresholds = { pass: 0.8, fail: 0.2 };

function job(id = 'greeting'): JudgmentJob {
  return {
    id,
    grader: { id: 'greeting-check', version: 1 },
    evidence: {
      id: 'greeting-evidence',
      data: { agentMessage: 'Hello! How can I help?' },
      scope: 'Agent response',
      sourceRefs: ['message-1'],
      coverage: { complete: true, gaps: [] },
      omissions: [],
      applicability: 'applicable',
      view: { id: 'response', version: 1 },
      serializationVersion: 'canonical-json-v1',
      contentHash: 'hash',
    },
    question: 'Agent responded with a greeting.',
    rubric: {
      pass: 'The agent greets the user.',
      fail: 'The agent does not greet the user.',
      unknown: 'The visible response is inconclusive.',
    },
  };
}

function result(answers: Record<string, unknown>) {
  return {
    model: JEV_MODEL,
    answers,
    usage: { input_tokens: 50, output_tokens: 2 },
  };
}

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

test('Noul batches matching states, maps criteria, and records exact probability and thresholds', async () => {
  let calls = 0;
  const judge = jevNoulJudge({
    apiKey: API_KEY,
    thresholds,
    fetch: async (url, init) => {
      calls++;
      assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
      assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${API_KEY}`);
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, JEV_MODEL);
      assert.deepEqual(Object.keys(body.questions), ['greeting', 'second']);
      for (const question of Object.values(body.questions) as Array<Record<string, unknown>>) {
        assert.equal(question.type, 'noul');
        assert.deepEqual(question.criteria, {
          false: 'The agent does not greet the user.',
          true: 'The agent greets the user.',
        });
        const instructions = question.instructions as Record<string, unknown>;
        assert.match(String(instructions.evidencePolicy), /untrusted evidence/);
        assert.equal(instructions.task, 'Agent responded with a greeting.');
        assert.equal(instructions.uncertaintyPolicy, 'The visible response is inconclusive.');
      }
      return response(
        result({
          greeting: { type: 'noul', noul: 0.9 },
          second: { type: 'noul', noul: 0.1 },
        }),
      );
    },
  });
  const [request] = await judge.prepare([job(), job('second')]);
  assert.equal(calls, 0);
  assert.equal(request.metadata.primitive, 'noul');
  assert.deepEqual(request.metadata.thresholds, thresholds);
  assert.equal(canonicalJson(request.body).includes(API_KEY), false);
  const completed = await judge.execute(request);
  assert.equal(calls, 1);
  assert.deepEqual(
    completed.answers.map(({ verdict }) => verdict),
    ['pass', 'fail'],
  );
  assert.deepEqual(completed.answers[0].metadata, { noul: 0.9, thresholds });
  assert.deepEqual(completed.answers[1].metadata, { noul: 0.1, thresholds });
  assert.deepEqual(
    completed.raw,
    result({
      greeting: { type: 'noul', noul: 0.9 },
      second: { type: 'noul', noul: 0.1 },
    }),
  );
  assert.equal('confidence' in completed.answers[0].metadata!, false);
});

test('Noul maps the uncertain interval to unknown, with inclusive pass/fail thresholds', async () => {
  const cases = [
    [0, 'fail'],
    [0.2, 'fail'],
    [0.5, 'unknown'],
    [0.8, 'pass'],
    [1, 'pass'],
  ] as const;
  for (const [noul, expected] of cases) {
    const judge = jevNoulJudge({
      apiKey: API_KEY,
      thresholds,
      fetch: async () => response(result({ greeting: { type: 'noul', noul } })),
    });
    const [request] = await judge.prepare([job()]);
    const completed = await judge.execute(request);
    assert.equal(completed.answers[0].verdict, expected);
    assert.deepEqual(completed.answers[0].metadata, { noul, thresholds });
  }
});

test('Noul requires explicit valid thresholds and rejects invalid probabilities', async () => {
  for (const invalid of [
    undefined,
    { pass: 0.2, fail: 0.2 },
    { pass: 0.1, fail: 0.2 },
    { pass: 1.1, fail: 0.2 },
    { pass: Number.NaN, fail: 0.2 },
    { pass: 0.8, fail: -0.1 },
  ]) {
    assert.throws(
      () =>
        jevNoulJudge({
          apiKey: API_KEY,
          thresholds: invalid as typeof thresholds,
        }),
      /thresholds/,
    );
  }
  for (const invalid of [-0.1, 1.1, Number.NaN, '0.9', null]) {
    const raw = result({ greeting: { type: 'noul', noul: invalid } });
    const judge = jevNoulJudge({
      apiKey: API_KEY,
      thresholds,
      fetch: async () => response(raw),
    });
    const [request] = await judge.prepare([job()]);
    await assert.rejects(judge.execute(request), (error: unknown) => {
      assert.ok(error instanceof JudgeExecutionError);
      assert.match(error.message, /invalid Noul answer/);
      assert.deepEqual(error.receivedResponse, JSON.parse(JSON.stringify(raw)));
      return true;
    });
  }
  const notApplicable = job();
  notApplicable.rubric.not_applicable = 'The requirement does not apply.';
  await assert.rejects(
    jevNoulJudge({ apiKey: API_KEY, thresholds }).prepare([notApplicable]),
    /applicability is resolved before dispatch/,
  );
});

test('Noul and Choice use distinct primitive requests while retaining the existing Choice contract', async () => {
  const choice = jevJudge({ apiKey: API_KEY });
  const noul = jevNoulJudge({ apiKey: API_KEY, thresholds });
  const [choiceRequest] = await choice.prepare([job()]);
  const [noulRequest] = await noul.prepare([job()]);
  assert.equal(
    (choiceRequest.body.questions as Record<string, { type: string }>).greeting.type,
    'choice',
  );
  assert.equal(
    (noulRequest.body.questions as Record<string, { type: string }>).greeting.type,
    'noul',
  );
  assert.notEqual(choice.id, noul.id);
});
