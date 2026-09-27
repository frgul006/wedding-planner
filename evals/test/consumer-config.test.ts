import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import config from '../config.ts';
import revisedQuestion from '../revised-question.config.ts';
import { loginRetry } from '../tasks/login-retry.ts';
import { resolveSourceRepo } from '../environment/repository/source-repo.ts';

const repo = resolve(import.meta.dirname, '../..');

test('Wedding authors the pinned task and grading expectations in ordinary config', () => {
  assert.deepEqual(config.suite.tasks, [loginRetry]);
  assert.equal(config.suite.id, 'login-retry-diagnosis');
  assert.equal(config.budgetUsd, 0.05);
  assert.equal(loginRetry.version, '2');
  assert.equal(loginRetry.metadata.acceptance, 'admin-login-retry');
  assert.deepEqual(loginRetry.metadata.validation.requiredChecks, [
    'lint',
    'build',
    'browser_snapshot',
  ]);
  const { revision } = loginRetry.metadata.repository;
  assert.equal(revision, '30d2388f71595d1ba65d0d2fabc8b97b6ee48f80');
  const entry = execFileSync('git', ['ls-tree', revision, '--', loginRetry.metadata.targetFile], {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.match(entry, /^100(?:644|755) blob /);
  assert.deepEqual(
    config.suite.graders.map(({ id, version, view }) => [id, version, view.id, view.version]),
    [
      ['falsifiable-hypothesis', 2, 'diagnosis', 2],
      ['relevant-probe', 2, 'diagnosis', 2],
      ['validation-after-final-edit', 5, 'validationHistory', 6],
    ],
  );
});

test('the alternate config changes only the hypothesis question over the default evidence', () => {
  assert.equal(revisedQuestion.createRunner, config.createRunner);
  assert.equal(revisedQuestion.createJudge, config.createJudge);
  assert.deepEqual(revisedQuestion.suite.tasks, config.suite.tasks);
  assert.equal(revisedQuestion.suite.graders[0].version, 3);
  assert.equal(revisedQuestion.suite.graders[0].view, config.suite.graders[0].view);
  const revised = revisedQuestion.suite.graders[0];
  const original = config.suite.graders[0];
  assert.ok(revised.kind === 'model');
  assert.ok(original.kind === 'model');
  assert.notEqual(revised.question, original.question);
  assert.equal(revisedQuestion.suite.graders[1], config.suite.graders[1]);
  assert.equal(revisedQuestion.suite.graders[2], config.suite.graders[2]);
  assert.equal(config.suite.graders[0].version, 2);
});

test('importing consumer config needs no Pi installation, environment file, or source checkout', async () => {
  const empty = await mkdtemp(join(tmpdir(), 'eval-config-import-'));
  try {
    const output = execFileSync(
      process.execPath,
      [
        '--import',
        import.meta.resolve('tsx'),
        '--input-type=module',
        '-e',
        `const { default: config } = await import(${JSON.stringify(new URL('../config.ts', import.meta.url).href)}); console.log(config.suite.id);`,
      ],
      {
        cwd: empty,
        env: {
          HOME: empty,
          PATH: '',
          EVAL_AGENT_SOURCE: join(empty, 'missing'),
        },
        encoding: 'utf8',
        timeout: 10_000,
      },
    );
    assert.equal(output.trim(), 'login-retry-diagnosis');
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
});

test('consumer resolves the original checkout from git common-dir', () => {
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();
  assert.equal(resolveSourceRepo(repo), resolve(common, '..'));
});
