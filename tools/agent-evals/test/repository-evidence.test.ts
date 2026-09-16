import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  collectRepositoryEvidence,
  snapshotRepository,
} from '../src/adapters/isolation/repository-evidence.ts';
import {
  prepareRepositoryCheckout,
  prepareRepositoryRuntime,
  repositoryGit,
} from '../src/adapters/isolation/repository-checkout.ts';
import { minimalEnvironment } from '../src/adapters/isolation/sandbox.ts';
import { createTrialPaths } from '../src/adapters/isolation/trial-paths.ts';

test('documentation acceptance requires command and route inside the added section', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'eval-docs-acceptance-'));
  const target = join(workspace, 'admin-auth.md');
  const script = fileURLToPath(
    new URL('../src/adapters/isolation/repository-acceptance.mjs', import.meta.url),
  );
  const check = () =>
    promisify(execFile)(process.execPath, [
      script,
      'unused',
      'unused',
      'http://127.0.0.1:1',
      'local-development-docs',
      target,
    ]);
  const existing = '# Admin authentication\nStart with pnpm dev and visit /admin/login.\n';
  try {
    await writeFile(target, existing + '\n## Verify the admin login page\n');
    await assert.rejects(check(), /new section must include the startup command/);
    await writeFile(
      target,
      existing + '\n## Verify the admin login page\npnpm dev\n\n## Other section\n/admin/login\n',
    );
    await assert.rejects(check(), /new section must include the login route/);
    await writeFile(
      target,
      existing +
        '\n## Verify the admin login page\nRun pnpm dev and open /admin/login. Rendering the form does not test successful authentication.\n',
    );
    assert.match((await check()).stdout, /presence check passed/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('retained source and patch include ignored additions, deletions, nested generated-looking paths and agent commits', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'eval-repository-evidence-'));
  const env = minimalEnvironment(workspace, workspace, dirname(process.execPath));
  try {
    await writeFile(join(workspace, 'target.tsx'), 'export const label = "Before";\n');
    await writeFile(join(workspace, 'removed.txt'), 'retain deleted content\n');
    await repositoryGit(workspace, ['init'], env);
    await repositoryGit(workspace, ['add', '.'], env);
    await repositoryGit(
      workspace,
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'baseline'],
      env,
    );
    const baselineCommit = (
      await repositoryGit(workspace, ['rev-parse', 'HEAD'], env)
    ).stdout.trim();
    const baseline = await snapshotRepository(workspace);
    await writeFile(join(workspace, 'target.tsx'), 'export const label = "After";\n');
    await rm(join(workspace, 'removed.txt'));
    await writeFile(join(workspace, '.gitignore'), 'ignored.ts\n');
    await writeFile(join(workspace, 'ignored.ts'), 'export const unrelated = true;\n');
    await mkdir(join(workspace, 'app/.next'), { recursive: true });
    await writeFile(join(workspace, 'app/.next/new.ts'), 'nested source\n');
    await repositoryGit(workspace, ['add', '-A'], env);
    await repositoryGit(
      workspace,
      [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.invalid',
        'commit',
        '-m',
        'agent result',
      ],
      env,
    );
    const result = await collectRepositoryEvidence({
      workspace,
      baseline,
      baselineCommit,
      env,
      checks: [],
      artifacts: [],
    });
    assert.deepEqual(result.changedFiles, [
      '.gitignore',
      'app/.next/new.ts',
      'ignored.ts',
      'removed.txt',
      'target.tsx',
    ]);
    assert.match(result.patch!.content, /After/);
    assert.match(result.patch!.content, /retain deleted content/);
    assert.match(result.patch!.content, /unrelated = true/);
    assert.match(result.patch!.content, /nested source/);
    assert.equal(
      result.beforeArtifacts!.find((item) => item.path === 'target.tsx')!.content,
      'export const label = "Before";\n',
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('source inventory rejects escaping symlinks rather than silently omit evidence', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'eval-repository-symlink-'));
  try {
    await symlink('/etc/passwd', join(workspace, 'target.tsx'));
    await assert.rejects(snapshotRepository(workspace), /unsupported symlink/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('repository preparation rejects installed dependencies with a different application lock', async () => {
  const source = await mkdtemp(join(tmpdir(), 'eval-dependency-lock-'));
  const paths = await createTrialPaths();
  const env = minimalEnvironment(source, source, dirname(process.execPath));
  try {
    await writeFile(
      join(source, 'pnpm-lock.yaml'),
      "---\npackageManager: pnpm12\n---\nlockfileVersion: '9.0'\npackages: {}\n",
    );
    await repositoryGit(source, ['init'], env);
    await repositoryGit(source, ['add', 'pnpm-lock.yaml'], env);
    await repositoryGit(
      source,
      [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.invalid',
        'commit',
        '-m',
        'dependency baseline',
      ],
      env,
    );
    const revision = (await repositoryGit(source, ['rev-parse', 'HEAD'], env)).stdout.trim();
    await mkdir(join(source, 'node_modules/.pnpm'), { recursive: true });
    await writeFile(
      join(source, 'node_modules/.pnpm/lock.yaml'),
      "lockfileVersion: '9.0'\npackages: { unexpected: true }\n",
    );
    await assert.rejects(
      prepareRepositoryCheckout({
        sourceRepo: source,
        dependencyRepo: source,
        revision,
        paths,
        acceptance: 'admin-login-copy',
      }),
      /Installed node_modules does not match/,
    );
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(paths.root, { recursive: true, force: true });
  }
});

test('repository runtime creates only local placeholders, blocks telemetry and uses offline font responses', async () => {
  const paths = await createTrialPaths();
  try {
    await assert.rejects(
      prepareRepositoryCheckout({
        sourceRepo: '/not-read',
        dependencyRepo: '/not-read',
        revision: 'a'.repeat(40),
        paths,
        acceptance: 'misspelled-check',
      }),
      /Unknown repository acceptance/,
    );
    const runtime = await prepareRepositoryRuntime(paths, 59876);
    assert.equal(
      new URL(runtime.environment.NEXT_PUBLIC_SUPABASE_URL).origin,
      'http://127.0.0.1:59876',
    );
    assert.equal(runtime.environment.SUPABASE_SECRET_KEY, 'evaluation-local-placeholder');
    assert.equal(runtime.environment.NEXT_TELEMETRY_DISABLED, '1');
    assert.equal(runtime.environment.PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN, 'false');
    assert.match(await readFile(runtime.fontResponses, 'utf8'), /local\('Arial'\)/);
  } finally {
    await rm(paths.root, { recursive: true, force: true });
  }
});
