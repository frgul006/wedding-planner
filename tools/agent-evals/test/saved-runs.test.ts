import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { FileRunStore } from '../src/adapters/file-run-store.ts';
import {
  listRuns,
  readSavedRun,
  resolveRun,
  sealRegrade,
  selectGrading,
  verifyIntegrity,
} from '../src/adapters/saved-runs.ts';
import type { Grade, TrialEvidence } from '../src/domain/types.ts';

const mechanical: Grade = {
  grader: 'target-outcome',
  version: '1',
  verdict: 'pass',
  reason: 'Expected text observed',
  evidenceRefs: ['target'],
};
const semantic: Grade = {
  grader: 'semantic-task-clarity',
  version: '1',
  verdict: 'pass',
  reason: 'Clear text',
  evidenceRefs: ['target'],
};
const evidence: TrialEvidence = {
  task: {
    id: 'docs-only',
    version: '1',
    kind: 'docs',
    prompt: 'Document startup',
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
      content: 'pnpm dev',
      sha256: 'test-content-hash',
      observedBy: 'evaluator',
    },
  ],
  agent: {
    status: 'completed',
    startedAt: '2026-09-07T12:00:00Z',
    endedAt: '2026-09-07T12:01:00Z',
    exitCode: 0,
    signal: null,
    model: null,
    thinkingLevel: null,
    events: [],
    usage: {
      inputTokens: 10,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      estimatedCostUsd: 0,
      costSource: 'offline test',
    },
  },
};

async function fixture(run: (repo: string) => Promise<void>) {
  const repo = await mkdtemp(join(tmpdir(), 'eval-saved-runs-'));
  try {
    await run(repo);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}

async function saveTrial(repo: string, id = 'trial-one', startedAt = '2026-09-07T12:00:00Z') {
  const store = new FileRunStore(join(repo, 'evals/runs', id));
  await store.initialize();
  await store.save('manifest.json', {
    id,
    startedAt,
    variant: 'enabled',
    status: 'completed',
    invariants: {},
    comparisonEligible: true,
  });
  await store.save('evidence.json', evidence);
  await store.save('grades.json', [mechanical, semantic]);
  await store.save('semantic.json', {
    status: 'completed',
    grade: semantic,
    usage: { estimatedCostUsd: 0.0001 },
  });
  await store.save('report.md', '# Original trial');
  await store.seal(['manifest.json', 'evidence.json', 'grades.json', 'semantic.json', 'report.md']);
  return store;
}

async function saveRevision(store: FileRunStore, name: string, sealed = true) {
  await store.save(`${name}.json`, {
    grades: [{ ...mechanical, version: '2' }],
    sourceIntegrityHash: await verifyIntegrity(store.directory),
    harnessHash: 'updated-harness',
    regradedAt: '2026-09-07T13:00:00Z',
    budget: { appliesTo: 'offline' },
    criteria: { deterministicVersion: '2' },
  });
  await store.save(`${name}.md`, '# Regraded trial');
  if (sealed) await sealRegrade(store, name);
}

test('saved evidence retains final acceptance, full patch and rich grader metadata for regrading', async () => {
  await fixture(async (repo) => {
    const store = await saveTrial(repo);
    const enriched = {
      ...evidence,
      beforeArtifacts: [
        { ...evidence.artifacts[0], id: 'before-target', content: 'Original documentation' },
      ],
      patch: { ...evidence.artifacts[0], id: 'patch', path: 'changes.patch', content: '+pnpm dev' },
      changedFiles: ['README.md'],
      checks: [
        {
          id: 'lint',
          actor: 'evaluator',
          command: ['pnpm', 'lint'],
          exitCode: 0,
          stdout: 'Passed',
          stderr: '',
          status: 'pass',
        },
      ],
    };
    const results = [
      {
        grader: 'target-outcome',
        version: '1',
        status: 'completed',
        grades: [mechanical],
        metadata: { source: 'independent' },
      },
    ];
    await store.save('evidence.json', enriched);
    await store.save('grading-results.json', results);
    await store.seal([
      'manifest.json',
      'evidence.json',
      'grades.json',
      'semantic.json',
      'report.md',
      'grading-results.json',
    ]);
    const loaded = await readSavedRun(store.directory);
    assert.deepEqual(loaded.evidence.beforeArtifacts, enriched.beforeArtifacts);
    assert.deepEqual(loaded.evidence.patch, enriched.patch);
    assert.deepEqual(loaded.evidence.changedFiles, enriched.changedFiles);
    assert.deepEqual(loaded.evidence.checks, enriched.checks);
    assert.deepEqual(loaded.original.gradingResults, results);
  });
});

test('saved run selectors accept IDs, caller-relative paths and latest by trial time', async () => {
  await fixture(async (repo) => {
    const first = await saveTrial(repo, 'trial-first', '2026-09-07T12:00:00Z');
    const last = await saveTrial(repo, 'trial-latest', '2026-09-07T13:00:00Z');
    const caller = join(repo, 'scripts');
    await mkdir(caller);
    assert.equal(await resolveRun(repo, 'trial-first', caller), first.directory);
    assert.equal(await resolveRun(repo, '../evals/runs/trial-first', caller), first.directory);
    assert.equal(await resolveRun(repo, last.directory, caller), last.directory);
    assert.equal(await resolveRun(repo, 'latest', caller), last.directory);
    assert.deepEqual(
      (await listRuns(repo)).map((run) => run.id),
      ['trial-latest', 'trial-first'],
    );
    await assert.rejects(resolveRun(repo, 'missing', caller), /was not found/);
  });
});

test('empty result catalogs are useful and diagnostic folders are excluded', async () => {
  await fixture(async (repo) => {
    assert.deepEqual(await listRuns(repo), []);
    await assert.rejects(resolveRun(repo, 'latest', repo), /No saved trials/);
    await mkdir(join(repo, 'evals/runs/doctor-check'), { recursive: true });
    await writeFile(join(repo, 'evals/runs/doctor-check/inspection.json'), '{}');
    assert.deepEqual(await listRuns(repo), []);
  });
});

test('tampering with an originally sealed grade fails integrity verification', async () => {
  await fixture(async (repo) => {
    const store = await saveTrial(repo);
    assert.equal((await readSavedRun(store.directory)).original.grades.length, 2);
    await store.save('grades.json', [{ ...mechanical, verdict: 'fail' }]);
    await assert.rejects(
      readSavedRun(store.directory),
      /Evidence integrity check failed: grades.json/,
    );
  });
});

for (const artifact of ['grades.json', 'semantic.json']) {
  test(`original ${artifact} must be covered by the integrity seal before it is trusted`, async () => {
    await fixture(async (repo) => {
      const store = await saveTrial(repo);
      const seal = JSON.parse(await readFile(join(store.directory, 'integrity.json'), 'utf8'));
      delete seal.files[artifact];
      await store.save('integrity.json', seal);
      await assert.rejects(
        readSavedRun(store.directory),
        /missing from the evidence integrity seal/,
      );
    });
  });
}

test('whole grading revision selection never silently merges an old semantic judgment', async () => {
  await fixture(async (repo) => {
    const store = await saveTrial(repo);
    assert.equal(selectGrading(await readSavedRun(store.directory)).id, 'original');
    const revision = 'regrade-2026-09-07T13-00-00';
    await saveRevision(store, revision);
    const run = await readSavedRun(store.directory);
    assert.equal(selectGrading(run, 'original').semantic !== undefined, true);
    assert.equal(selectGrading(run, 'original').grades.length, 2);
    assert.equal(selectGrading(run).id, revision);
    assert.equal(selectGrading(run).grades.length, 1);
    assert.equal(selectGrading(run).semantic, undefined);
    assert.equal(selectGrading(run, revision).harnessHash, 'updated-harness');
    assert.throws(() => selectGrading(run, 'missing'), /Unknown grading revision/);
    assert.deepEqual(run.warnings, []);
  });
});

test('a regrade for different source evidence is recorded without blocking the original', async () => {
  await fixture(async (repo) => {
    const store = await saveTrial(repo);
    const name = 'regrade-2026-09-07T13-00-00';
    await saveRevision(store, name);
    const revision = JSON.parse(await readFile(join(store.directory, `${name}.json`), 'utf8'));
    await store.save(`${name}.json`, {
      ...revision,
      sourceIntegrityHash: 'a-different-original-run',
    });
    await sealRegrade(store, name);
    const run = await readSavedRun(store.directory);
    assert.equal(selectGrading(run, 'original').grades.length, 2);
    assert.deepEqual(run.regrades, []);
    assert.deepEqual(run.invalidRegrades, [
      {
        id: name,
        reason: 'Regrade refers to different source evidence.',
      },
    ]);
    assert.throws(() => selectGrading(run, name), /different source evidence/);
    assert.throws(() => selectGrading(run), /different source evidence/);
  });
});

test('sealed regrade JSON or Markdown changes cannot be accepted as legacy revisions', async () => {
  await fixture(async (repo) => {
    const store = await saveTrial(repo);
    const name = 'regrade-2026-09-07T13-00-00';
    await saveRevision(store, name);
    await store.save(`${name}.md`, '# Changed after sealing');
    let run = await readSavedRun(store.directory);
    assert.equal(selectGrading(run, 'original').id, 'original');
    assert.match(run.invalidRegrades[0].reason, /Regrade integrity check failed/);
    assert.throws(() => selectGrading(run), /Regrade integrity check failed/);
    await saveRevision(store, name);
    await rm(join(store.directory, `${name}.md`));
    run = await readSavedRun(store.directory);
    assert.equal(selectGrading(run, 'original').id, 'original');
    assert.throws(() => selectGrading(run), /Markdown report is missing/);
  });
});

test('an interrupted latest revision does not hide behind an older valid grade, and regrading can recover', async () => {
  await fixture(async (repo) => {
    const store = await saveTrial(repo);
    const originalIntegrityHash = await verifyIntegrity(store.directory);
    const older = 'regrade-2026-09-07T13-00-00';
    const interrupted = 'regrade-2026-09-07T14-00-00';
    const recovered = 'regrade-2026-09-07T15-00-00';
    await saveRevision(store, older);
    await store.save(`${interrupted}.json`, '{"grades": [');
    await store.save(`${interrupted}.md`, '# Incomplete grading');

    const run = await readSavedRun(store.directory);
    assert.deepEqual(selectGrading(run, 'original').grades, [mechanical, semantic]);
    assert.equal(selectGrading(run, older).id, older);
    assert.deepEqual(run.invalidRegrades, [
      {
        id: interrupted,
        reason: 'Revision JSON or integrity metadata is incomplete or invalid.',
      },
    ]);
    assert.throws(() => selectGrading(run, interrupted), /Grading revision .* is invalid/);
    assert.throws(() => selectGrading(run), /Grading revision .*14-00-00.* is invalid/);

    await saveRevision(store, recovered);
    const recoveredRun = await readSavedRun(store.directory);
    assert.equal(selectGrading(recoveredRun).id, recovered);
    assert.deepEqual(recoveredRun.invalidRegrades, run.invalidRegrades);
    assert.equal(recoveredRun.integrityHash, originalIntegrityHash);
    assert.deepEqual(recoveredRun.evidence, run.evidence);
  });
});

for (const companion of ['md', 'integrity.json']) {
  test(`an orphaned revision ${companion} remains visible as an invalid latest revision`, async () => {
    await fixture(async (repo) => {
      const store = await saveTrial(repo);
      const older = 'regrade-2026-09-07T13-00-00';
      const orphaned = 'regrade-2026-09-07T14-00-00';
      await saveRevision(store, older);
      await store.save(`${orphaned}.${companion}`, 'Incomplete revision');
      const run = await readSavedRun(store.directory);
      assert.equal(selectGrading(run, 'original').id, 'original');
      assert.equal(run.invalidRegrades[0].id, orphaned);
      assert.throws(() => selectGrading(run), /14-00-00.* is invalid/);
      assert.throws(() => selectGrading(run, orphaned), /is missing/);
    });
  });
}

test('a revision missing its report is incomplete even without an integrity seal', async () => {
  await fixture(async (repo) => {
    const store = await saveTrial(repo);
    const name = 'regrade-2026-09-07T13-00-00';
    await saveRevision(store, name, false);
    await rm(join(store.directory, `${name}.md`));
    const run = await readSavedRun(store.directory);
    assert.equal(selectGrading(run, 'original').id, 'original');
    assert.throws(() => selectGrading(run), /Markdown report is missing/);
  });
});

for (const corruption of ['invalid-seal', 'invalid-revision-shape', 'changed-json']) {
  test(`${corruption} is recorded as invalid without weakening original integrity checks`, async () => {
    await fixture(async (repo) => {
      const store = await saveTrial(repo);
      const name = 'regrade-2026-09-07T13-00-00';
      await saveRevision(store, name);
      if (corruption === 'invalid-seal') await store.save(`${name}.integrity.json`, '{');
      else if (corruption === 'invalid-revision-shape') await store.save(`${name}.json`, {});
      else {
        const revision = JSON.parse(await readFile(join(store.directory, `${name}.json`), 'utf8'));
        await store.save(`${name}.json`, { ...revision, harnessHash: 'changed-after-sealing' });
      }
      const run = await readSavedRun(store.directory);
      assert.equal(run.invalidRegrades[0].id, name);
      assert.equal(selectGrading(run, 'original').id, 'original');
      assert.throws(() => selectGrading(run), /Grading revision .* is invalid/);
      await store.save('grades.json', [{ ...mechanical, verdict: 'fail' }]);
      await assert.rejects(
        readSavedRun(store.directory),
        /Evidence integrity check failed: grades.json/,
      );
    });
  });
}

test('historical unsealed regrades disclose their weaker provenance', async () => {
  await fixture(async (repo) => {
    const store = await saveTrial(repo);
    const name = 'regrade-2026-09-07T13-00-00';
    await saveRevision(store, name, false);
    const run = await readSavedRun(store.directory);
    assert.equal(selectGrading(run).id, name);
    assert.equal(run.warnings.length, 1);
    assert.match(run.warnings[0], /appended grading is unsealed/);
  });
});

test('unsealed initial evidence cannot be used for grading or conclusions', async () => {
  await fixture(async (repo) => {
    const store = await saveTrial(repo);
    await rm(join(store.directory, 'integrity.json'));
    await assert.rejects(readSavedRun(store.directory), /not sealed/);
  });
});
