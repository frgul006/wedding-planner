import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  catalogNames,
  loadProfile,
  loadTask,
  treeHash,
} from '../src/adapters/evaluation-config.ts';

const task = {
  id: 'new-docs-case',
  version: '1',
  kind: 'docs',
  prompt: 'Document the local command.',
  targetFile: 'docs/development.md',
  expectedText: 'pnpm dev',
  flowPath: '/',
};
const profile = {
  id: 'smoke',
  concurrency: 1,
  runtimeMs: 300_000,
  maxAgentTokens: 300_000,
  agentBilling: 'subscription',
  maxAgentEstimatedCostUsd: null,
  estimatedApiBudgetUsd: 1,
  agentRetries: 0,
  grader: {
    model: 'gpt-5.6-luna',
    reasoningEffort: 'none',
    maxOutputTokens: 800,
    maxInputChars: 18_000,
    timeoutMs: 20_000,
    maxRetries: 0,
    inputPerMillion: 0.2,
    outputPerMillion: 1.2,
    pricingSource: 'offline test',
    pricingCheckedOn: '2026-09-07',
  },
};

async function fixture(run: (repo: string) => Promise<void>) {
  const repo = await mkdtemp(join(tmpdir(), 'eval-configuration-'));
  try {
    for (const directory of ['tasks', 'profiles', 'rubrics', 'fixtures/wedding-copy/docs']) {
      await mkdir(join(repo, 'evals', directory), { recursive: true });
    }
    await writeFile(
      join(repo, 'evals/fixtures/wedding-copy/docs/development.md'),
      'Start the local server.',
    );
    await writeFile(join(repo, 'evals/rubrics/task-clarity.md'), 'Grade clarity.');
    await writeFile(join(repo, 'evals/profiles/smoke.json'), JSON.stringify(profile));
    await writeFile(join(repo, 'evals/tasks/new-docs-case.json'), JSON.stringify(task));
    await run(repo);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}

test('adding another task JSON discovers its fixture, rubric and nested target without CLI changes', async () => {
  await fixture(async (repo) => {
    assert.deepEqual(await catalogNames(repo, 'tasks'), ['new-docs-case']);
    const loaded = await loadTask(repo, 'new-docs-case');
    assert.equal(loaded.id, 'new-docs-case');
    assert.equal(loaded.fixture, 'wedding-copy');
    assert.equal(loaded.rubric, 'task-clarity');
    assert.equal(loaded.targetFile, 'docs/development.md');
  });
});

test('unknown task names explain the actual catalog and reject traversal', async () => {
  await fixture(async (repo) => {
    await assert.rejects(loadTask(repo, 'missing'), /Available: new-docs-case/);
    await assert.rejects(loadTask(repo, '../new-docs-case'), /Unknown task/);
    await writeFile(
      join(repo, 'evals/tasks/new-docs-case.json'),
      JSON.stringify({ ...task, id: 'different-name' }),
    );
    await assert.rejects(loadTask(repo, 'new-docs-case'), /must match its filename/);
  });
});

test('target paths cannot escape with traversal, absolute paths or backslashes', async () => {
  await fixture(async (repo) => {
    for (const targetFile of [
      '../outside.md',
      '/tmp/outside.md',
      'docs/../../outside.md',
      'docs\\outside.md',
    ]) {
      await writeFile(
        join(repo, 'evals/tasks/new-docs-case.json'),
        JSON.stringify({ ...task, targetFile }),
      );
      await assert.rejects(loadTask(repo, 'new-docs-case'), /without \.\. or absolute paths/);
    }
  });
});

test('a symlink target is rejected even when its destination stays within the fixture', async () => {
  await fixture(async (repo) => {
    await symlink('development.md', join(repo, 'evals/fixtures/wedding-copy/docs/alias.md'));
    await writeFile(
      join(repo, 'evals/tasks/new-docs-case.json'),
      JSON.stringify({ ...task, targetFile: 'docs/alias.md' }),
    );
    await assert.rejects(loadTask(repo, 'new-docs-case'), /symlink|symbolic/i);
  });
});

test('fixture and target symlinks cannot read outside the fixture boundary', async () => {
  await fixture(async (repo) => {
    await writeFile(join(repo, 'outside.md'), 'Outside evaluation fixture');
    await symlink(
      join(repo, 'outside.md'),
      join(repo, 'evals/fixtures/wedding-copy/docs/outside.md'),
    );
    await writeFile(
      join(repo, 'evals/tasks/new-docs-case.json'),
      JSON.stringify({ ...task, targetFile: 'docs/outside.md' }),
    );
    await assert.rejects(loadTask(repo, 'new-docs-case'));
    await symlink(repo, join(repo, 'evals/fixtures/outside'));
    await writeFile(
      join(repo, 'evals/tasks/new-docs-case.json'),
      JSON.stringify({ ...task, fixture: 'outside', targetFile: 'outside.md' }),
    );
    await assert.rejects(loadTask(repo, 'new-docs-case'), /inside evals\/fixtures/);
  });
});

test('model changes require paired explicit prices and preserve subscription/API billing separation', async () => {
  await fixture(async (repo) => {
    await assert.rejects(
      loadProfile(repo, 'smoke', { graderModel: 'expensive' }),
      /different grader model requires/,
    );
    await assert.rejects(loadProfile(repo, 'smoke', { graderInputPrice: '1' }), /both/);
    await assert.rejects(
      loadProfile(repo, 'smoke', { graderInputPrice: '1', graderOutputPrice: '2' }),
      /require --grader-model/,
    );
    await assert.rejects(
      loadProfile(repo, 'smoke', { budgetUsd: 'NaN' }),
      /Invalid evaluation configuration/,
    );
    const changed = await loadProfile(repo, 'smoke', {
      budgetUsd: '.01',
      graderModel: 'custom-model',
      graderInputPrice: '.1',
      graderOutputPrice: '.5',
    });
    assert.equal(changed.estimatedApiBudgetUsd, 0.01);
    assert.equal(changed.maxAgentEstimatedCostUsd, null);
    assert.equal(changed.grader.model, 'custom-model');
    assert.equal(changed.grader.inputPerMillion, 0.1);
    await writeFile(
      join(repo, 'evals/profiles/smoke.json'),
      JSON.stringify({ ...profile, agentBilling: 'api' }),
    );
    await assert.rejects(loadProfile(repo), /API-billed Pi requires/);
  });
});

test('versioned input hashes change with file content and reject symlink resources', async () => {
  await fixture(async (repo) => {
    const directory = join(repo, 'evals/fixtures/wedding-copy');
    const before = await treeHash(directory);
    await writeFile(join(directory, 'docs/development.md'), 'Changed startup guidance');
    assert.notEqual(await treeHash(directory), before);
    await symlink('development.md', join(directory, 'docs/link.md'));
    await assert.rejects(treeHash(directory), /Unexpected symlink/);
  });
});
