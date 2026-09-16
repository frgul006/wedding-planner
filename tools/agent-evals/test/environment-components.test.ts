import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import {
  applicationBrowserRevision,
  resolveHeadlessBrowser,
} from '../src/adapters/isolation/runtime.ts';
import { TrialProcesses } from '../src/adapters/isolation/processes.ts';
import { copyResources, resourceFilesIn } from '../src/adapters/isolation/resources.ts';

test('browser selection uses the current architecture and skips incomplete newer downloads', async () => {
  const cache = await realpath(await mkdtemp(join(tmpdir(), 'eval-runtime-test-')));
  try {
    const install = async (revision: number, architecture: string, executable = true) => {
      const directory = join(
        cache,
        `chromium_headless_shell-${revision}`,
        `chrome-headless-shell-mac-${architecture}`,
      );
      await mkdir(directory, { recursive: true });
      if (executable)
        await writeFile(join(directory, 'chrome-headless-shell'), 'synthetic executable', {
          mode: 0o700,
        });
      return directory;
    };
    const arm = await install(10, 'arm64');
    const intel = await install(11, 'x64');
    await install(12, 'arm64', false);
    assert.equal((await resolveHeadlessBrowser(cache, 'arm64')).directory, arm);
    assert.equal((await resolveHeadlessBrowser(cache, 'x64')).directory, intel);
    const newer = await install(13, 'arm64');
    assert.equal((await resolveHeadlessBrowser(cache, 'arm64')).directory, newer);
    const pinned = await resolveHeadlessBrowser(cache, 'arm64', '10');
    assert.equal(pinned.directory, arm);
    assert.equal(pinned.revision, '10');
    await assert.rejects(resolveHeadlessBrowser(cache, 'arm64', '12'), /revision 12/);
    await assert.rejects(resolveHeadlessBrowser(cache, 'arm64', '../10'), /Invalid.*revision/);
    await rm(newer, { recursive: true });
    await rm(arm, { recursive: true });
    await assert.rejects(resolveHeadlessBrowser(cache, 'arm64'), /No executable.*macOS arm64/);
  } finally {
    await rm(cache, { recursive: true, force: true });
  }
});

test('browser revision comes from the application Playwright dependency chain', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eval-app-browser-test-'));
  try {
    await writeFile(join(root, 'package.json'), '{"name":"test-app"}');
    for (const name of ['@playwright/test', 'playwright', 'playwright-core']) {
      const directory = join(root, 'node_modules', name);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, 'package.json'), JSON.stringify({ name, main: 'index.js' }));
      await writeFile(join(directory, 'index.js'), '');
    }
    const registry = join(root, 'node_modules/playwright-core/browsers.json');
    await writeFile(
      registry,
      JSON.stringify({ browsers: [{ name: 'chromium-headless-shell', revision: '1243' }] }),
    );
    assert.equal(await applicationBrowserRevision(root), '1243');
    const alternate = join(root, 'separate-dependency-checkout');
    await mkdir(alternate);
    await writeFile(join(alternate, 'package.json'), '{"name":"separate-app"}');
    for (const name of ['@playwright/test', 'playwright', 'playwright-core']) {
      const directory = join(alternate, 'node_modules', name);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, 'package.json'), JSON.stringify({ name, main: 'index.js' }));
      await writeFile(join(directory, 'index.js'), '');
    }
    await writeFile(
      join(alternate, 'node_modules/playwright-core/browsers.json'),
      JSON.stringify({ browsers: [{ name: 'chromium-headless-shell', revision: '1250' }] }),
    );
    assert.equal(await applicationBrowserRevision(alternate), '1250');
    assert.equal(await applicationBrowserRevision(root), '1243');
    await writeFile(
      registry,
      JSON.stringify({ browsers: [{ name: 'firefox', revision: '1543' }] }),
    );
    await assert.rejects(applicationBrowserRevision(root), /Cannot resolve.*revision/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('resource copying resolves the approved root but never includes secrets or child symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eval-resources-test-'));
  try {
    const source = join(root, 'source');
    const destination = join(root, 'trial');
    await mkdir(source);
    await writeFile(join(source, 'SKILL.md'), '# Synthetic skill');
    await writeFile(join(source, '.env.local'), 'secret fixture');
    await writeFile(join(source, 'auth.json'), 'secret fixture');
    await writeFile(join(root, 'outside'), 'outside fixture');
    await symlink(join(root, 'outside'), join(source, 'linked-secret'));
    await symlink(source, join(root, 'approved-skill'));
    await copyResources(join(root, 'approved-skill'), destination);
    assert.equal(await readFile(join(destination, 'SKILL.md'), 'utf8'), '# Synthetic skill');
    for (const name of ['.env.local', 'auth.json', 'linked-secret'])
      await assert.rejects(access(join(destination, name)));
    assert.deepEqual(await resourceFilesIn(destination), [join(destination, 'SKILL.md')]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test(
  'a corrupt tool registry cannot keep known evaluator processes alive',
  { skip: process.platform === 'win32' },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'eval-processes-test-'));
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      detached: true,
      stdio: 'ignore',
    });
    const exit = new Promise<{ signal: string | null }>((resolve) =>
      child.once('close', (_code, signal) => resolve({ signal })),
    );
    try {
      const processes = new TrialProcesses(join(root, 'groups.jsonl'));
      await processes.initialize();
      assert.ok(child.pid);
      processes.register(child.pid);
      await writeFile(join(root, 'groups.jsonl'), '{interrupted record');
      await assert.rejects(processes.stop(), /Malformed process registry/);
      assert.equal((await exit).signal, 'SIGKILL');
    } finally {
      if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* Already stopped. */
        }
      }
      await rm(root, { recursive: true, force: true });
    }
  },
);
