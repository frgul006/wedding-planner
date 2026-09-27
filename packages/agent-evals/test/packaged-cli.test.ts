import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execute = promisify(execFile);
const packageDirectory = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);

// This consumer is authored independently and imports only the published surface.
const graders = `
import { codeGrader, modelGrader, type View } from 'agent-evals';
const answer = {
  id: 'answer', version: 1,
  prepare(trial) { return [{
    id: 'visible-answer', data: {text: trial.trace.events[0].data.text},
    scope: 'The recorded assistant answer', sourceRefs: [trial.trace.events[0].id],
    coverage: {complete: trial.trace.complete, gaps: trial.trace.gaps},
    omissions: [], applicability: 'applicable' as const,
  }]; }
} satisfies View<{text: unknown}>;
const rubric = {pass: 'Answer satisfies the question', fail: 'Answer contradicts it', unknown: 'Cannot determine'};
export const graders = [
  codeGrader({id: 'has-answer', version: 1, view: answer,
    check: item => ({verdict: item.data.text ? 'pass' : 'fail', supportingRefs: item.sourceRefs})}),
  modelGrader({id: 'clear', version: 1, view: answer, question: 'Is the answer clear?', rubric}),
  modelGrader({id: 'relevant', version: 1, view: answer, question: 'Is the answer relevant?', rubric}),
];
`;
const config = `
import type { EvalConfig } from 'agent-evals';
import { graders } from './graders.ts';
export default {
  suite: {id: 'external-consumer', tasks: [{id: 'answer', version: 1, prompt: 'Explain a queue',
    limits: {maxTurns: 4}}], graders},
  async createRunner(context) {
    const { createRunner } = await import('./runner.ts');
    return createRunner(context);
  },
  async createJudge() {
    const { createJudge } = await import('./judge.ts');
    return createJudge();
  },
  budgetUsd: 0.01,
} satisfies EvalConfig;
`;
const runner = `
import { appendFile } from 'node:fs/promises';
import type { EvalConfig, Runner } from 'agent-evals';
export async function createRunner(context: Parameters<NonNullable<EvalConfig['createRunner']>>[0]): Promise<Runner> {
  await appendFile('factories.log', 'runner\\n');
  return {async run(task, request) { return {
    id: request.trialId, task, status: 'completed',
    trace: {events: [{id: 'answer-text', sequence: 1, timestamp: '2026-09-27',
      actor: 'agent', type: 'message', data: {role: 'assistant', text: 'A queue preserves arrival order.\\n🧪'}
    }], artifacts: [], contexts: [], complete: true, gaps: []},
    outcome: {context, limits: request.limits}, metadata: {authoredFixture: true}
  }; }};
}
`;
const judge = `
import { appendFile } from 'node:fs/promises';
import type { Judge } from 'agent-evals';
export async function createJudge(): Promise<Judge> {
  await appendFile('factories.log', 'judge\\n');
  return {
    id: 'offline-consumer-judge',
    async prepare(jobs) { return [{
      id: 'batch', jobIds: jobs.map(job => job.id), reservedCostUsd: 0.001,
      body: {state: jobs[0].evidence, questions: jobs.map(job => ({id: job.id, question: job.question}))},
      metadata: {fixture: true},
    }]; },
    async execute(request) { return {
      answers: request.jobIds.map(jobId => ({jobId, verdict: 'pass'})),
      raw: {fixture: 'one categorical batch'}, model: 'offline-fixture',
      usage: {inputTokens: 20, outputTokens: 2, estimatedCostUsd: 0.0001},
    }; },
  };
}
`;

test(
  'packed artifact supports a standalone typed consumer, CLI and append-only regrading',
  { timeout: 120_000 },
  async (t) => {
    const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'agent-evals-package-')));
    const consumer = path.join(directory, 'consumer');
    try {
      await mkdir(consumer);
      // The package test consumes the build, never rebuilds concurrently with other tests.
      await execute('pnpm', ['pack', '--ignore-scripts', '--pack-destination', directory], {
        cwd: packageDirectory,
        timeout: 30_000,
      });
      const archive = path.join(
        directory,
        (await readdir(directory)).find((name) => name.endsWith('.tgz'))!,
      );
      const manifest = JSON.parse(
        await readFile(path.join(packageDirectory, 'package.json'), 'utf8'),
      );
      const archiveReference = `file:../${path.basename(archive)}`;
      await writeFile(
        path.join(consumer, 'package.json'),
        JSON.stringify({
          name: 'independent-consumer',
          private: true,
          type: 'module',
          dependencies: { 'agent-evals': archiveReference },
          devDependencies: { '@types/node': manifest.devDependencies['@types/node'] },
        }),
      );
      // Seed the tarball and the library's pinned graph so a frozen install needs
      // neither registry metadata nor workspace links. Only dependency bytes are cached.
      const workspaceLock = (
        await readFile(path.join(packageDirectory, '../../pnpm-lock.yaml'), 'utf8')
      )
        .split('\n---\n')
        .at(-1)!;
      const importer = workspaceLock.match(
        /\n  packages\/agent-evals:\n([\s\S]*?)(?=\n  \S|\npackages:)/,
      )?.[1];
      assert.ok(importer, 'Library importer must exist in workspace lock');
      const versions = new Map(
        [
          ...importer.matchAll(
            /      '?([^':\n]+)'?:\n        specifier: [^\n]+\n        version: ([^\n]+)/g,
          ),
        ].map((entry) => [entry[1], entry[2]]),
      );
      const dependencies = Object.fromEntries(
        Object.keys(manifest.dependencies).map((name) => {
          assert.ok(versions.has(name), `Locked runtime dependency ${name}`);
          return [name, versions.get(name)];
        }),
      );
      const integrity =
        'sha512-' +
        createHash('sha512')
          .update(await readFile(archive))
          .digest('base64');
      const key = JSON.stringify(`agent-evals@${archiveReference}`);
      const consumerLock = workspaceLock
        .replace(
          /importers:\n[\s\S]*?\npackages:/,
          `importers:\n\n  .:
    dependencies:
      agent-evals:
        specifier: ${archiveReference}
        version: ${archiveReference}
    devDependencies:
      '@types/node':
        specifier: ${manifest.devDependencies['@types/node']}
        version: ${versions.get('@types/node')}
\npackages:`,
        )
        .replace(
          '\npackages:\n',
          `\npackages:\n\n  ${key}:
    resolution: {integrity: ${integrity}, tarball: ${archiveReference}}
    version: ${manifest.version}
    engines: ${JSON.stringify(manifest.engines)}
    hasBin: true
`,
        )
        .replace(
          '\nsnapshots:\n',
          `\nsnapshots:\n\n  ${key}:
    dependencies: ${JSON.stringify(dependencies)}
`,
        );
      await writeFile(path.join(consumer, 'pnpm-lock.yaml'), consumerLock);
      await execute(
        'pnpm',
        [
          'install',
          '--frozen-lockfile',
          '--offline',
          '--ignore-scripts',
          '--cache-dir',
          path.join(directory, 'empty-metadata-cache'),
        ],
        {
          cwd: consumer,
          timeout: 60_000,
        },
      );
      await Promise.all([
        writeFile(path.join(consumer, 'evals.config.ts'), config),
        writeFile(path.join(consumer, 'graders.ts'), graders),
        writeFile(path.join(consumer, 'runner.ts'), runner),
        writeFile(path.join(consumer, 'judge.ts'), judge),
        writeFile(
          path.join(consumer, 'offline.mjs'),
          `globalThis.fetch = async () => { throw new Error('Unexpected network dispatch'); };`,
        ),
        writeFile(
          path.join(consumer, 'public-api.ts'),
          `
import { createEvaluator, type EvalConfig } from 'agent-evals';
import { fileStore } from 'agent-evals/files';
import { piRunner } from 'agent-evals/pi';
import { jevJudge } from 'agent-evals/jev';
export type Config = EvalConfig;
export type PiOptions = Parameters<typeof piRunner>[0];
export type JevOptions = Parameters<typeof jevJudge>[0];
export const evaluator = createEvaluator({store: fileStore('.records')});
`,
        ),
      ]);
      const installed = path.join(consumer, 'node_modules/agent-evals');
      const binary = path.join(installed, 'dist/cli.js');
      const invoke = (args: string[]) =>
        execute(path.join(consumer, 'node_modules/.bin/agent-evals'), args, {
          cwd: consumer,
          env: {
            PATH: path.dirname(process.execPath) + ':/usr/bin:/bin',
            HOME: consumer,
            NO_COLOR: '1',
            NODE_OPTIONS: '--import ./offline.mjs',
          },
          timeout: 15_000,
        });

      await t.test(
        'published files and declarations are independent of source checkout',
        async () => {
          const installedManifest = JSON.parse(
            await readFile(path.join(installed, 'package.json'), 'utf8'),
          );
          assert.equal(installedManifest.bin['agent-evals'], './dist/cli.js');
          assert.equal((await readFile(binary, 'utf8')).split('\n')[0], '#!/usr/bin/env node');
          assert.deepEqual(
            (await readdir(installed)).filter(
              (name) => !['dist', 'README.md', 'package.json', 'node_modules'].includes(name),
            ),
            [],
          );
          await execute(
            process.execPath,
            [
              require.resolve('typescript/bin/tsc'),
              '--noEmit',
              '--strict',
              '--target',
              'ES2023',
              '--module',
              'NodeNext',
              '--moduleResolution',
              'NodeNext',
              '--allowImportingTsExtensions',
              '--types',
              'node',
              'evals.config.ts',
              'public-api.ts',
            ],
            { cwd: consumer, timeout: 30_000 },
          );
          const code = `import * as core from 'agent-evals'; import * as pi from 'agent-evals/pi'; import * as jev from 'agent-evals/jev'; import * as files from 'agent-evals/files'; if (!core.createEvaluator || !pi.piRunner || !jev.jevJudge || !files.fileStore) throw new Error('Missing public export');`;
          await execute(
            process.execPath,
            ['--import', './offline.mjs', '--input-type=module', '--eval', code],
            { cwd: consumer },
          );
        },
      );

      await t.test('dry-run loads relative TypeScript modules without factories', async () => {
        const preview = JSON.parse((await invoke(['run', '--dry-run', '--json'])).stdout);
        assert.equal(preview.suite, 'external-consumer');
        assert.equal(preview.factoriesInvoked, false);
        assert.equal(preview.graders.length, 3);
        await assert.rejects(readFile(path.join(consumer, 'factories.log')), { code: 'ENOENT' });
      });

      const run = JSON.parse((await invoke(['run', '--json'])).stdout);
      const store = path.join(consumer, '.agent-evals');
      const trialPath = path.join(store, 'trials', run.trialIds[0] + '.json');
      const gradePath = path.join(store, 'gradings', run.gradingIds[0], 'grading.json');
      const trialBefore = await readFile(trialPath, 'utf8');
      const gradeBefore = await readFile(gradePath, 'utf8');
      await t.test(
        'run records raw evidence, one shared view and one two-question batch',
        async () => {
          assert.equal(run.executionFailed, false);
          const trial = JSON.parse(trialBefore).value;
          const grade = JSON.parse(gradeBefore).value;
          assert.equal(trial.trace.events[0].data.text, 'A queue preserves arrival order.\n🧪');
          assert.equal(trial.outcome.context.recordingsDirectory, path.join(store, 'recordings'));
          assert.deepEqual(trial.outcome.limits, { maxTurns: 4 });
          assert.equal(grade.evidence.length, 1);
          assert.equal(grade.jobs.length, 2);
          assert.equal(grade.requests.length, 1);
          assert.equal(grade.requests[0].request.body.questions.length, 2);
          assert.deepEqual(grade.requests[0].request.body.state.sourceRefs, ['answer-text']);
          assert.deepEqual(
            (await readFile(path.join(consumer, 'factories.log'), 'utf8'))
              .trim()
              .split('\n')
              .sort(),
            ['judge', 'runner'],
          );
        },
      );

      await t.test(
        'show never imports executable config; regrade never creates runner',
        async () => {
          await writeFile(
            path.join(consumer, 'evals.config.ts'),
            `throw new Error('Show imported config');`,
          );
          const shown = JSON.parse((await invoke(['show', run.id, '--json'])).stdout);
          assert.equal(shown.trials[0].gradings.length, 1);
          await writeFile(
            path.join(consumer, 'evals.config.ts'),
            config.replace(
              "const { createRunner } = await import('./runner.ts');",
              `throw new Error('Regrade created runner'); const { createRunner } = await import('./runner.ts');`,
            ),
          );
          await writeFile(
            path.join(consumer, 'graders.ts'),
            graders
              .replace("id: 'clear', version: 1", "id: 'clear', version: 2")
              .replace('Is the answer clear?', 'Can a reader predict the removal order?'),
          );
          const regraded = JSON.parse((await invoke(['regrade', run.id, '--json'])).stdout);
          const grade = JSON.parse(
            await readFile(
              path.join(store, 'gradings', regraded.gradings[0].id, 'grading.json'),
              'utf8',
            ),
          ).value;
          assert.equal(grade.jobs[0].question, 'Can a reader predict the removal order?');
          assert.equal(grade.jobs[0].grader.version, 2);
          assert.equal(await readFile(trialPath, 'utf8'), trialBefore);
          assert.equal(await readFile(gradePath, 'utf8'), gradeBefore);
          assert.equal(
            (await readFile(path.join(consumer, 'factories.log'), 'utf8')).split('runner').length -
              1,
            1,
          );
        },
      );

      await t.test(
        'code-only and CommonJS host configs work without importing provider factories',
        async () => {
          const metadata = JSON.parse(await readFile(path.join(consumer, 'package.json'), 'utf8'));
          delete metadata.type;
          await writeFile(path.join(consumer, 'package.json'), JSON.stringify(metadata));
          await writeFile(
            path.join(consumer, 'evals.config.ts'),
            config.replace(
              "const { createJudge } = await import('./judge.ts');",
              "throw new Error('Code-only imported judge'); const { createJudge } = await import('./judge.ts');",
            ),
          );
          const codeOnly = JSON.parse(
            (await invoke(['regrade', run.id, '--code-only', '--json'])).stdout,
          );
          assert.deepEqual(codeOnly.skippedModelGraders, ['clear', 'relevant']);
          assert.equal(codeOnly.gradings[0].rollups.length, 1);
          assert.equal(codeOnly.gradings[0].rollups[0].verdict, 'pass');
          await rm(path.join(consumer, 'package.json'));
          const withoutManifest = JSON.parse((await invoke(['run', '--dry-run', '--json'])).stdout);
          assert.equal(withoutManifest.suite, 'external-consumer');
        },
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
