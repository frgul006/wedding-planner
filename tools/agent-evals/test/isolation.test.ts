import assert from 'node:assert/strict';
import {
  access,
  readFile,
  realpath,
  mkdtemp,
  mkdir,
  writeFile,
  symlink,
  rm,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { createServer } from 'node:net';
import { cleanupPrivateTrial } from '../src/adapters/isolation/cleanup.js';
import {
  safeFile,
  sandboxProfile,
  minimalEnvironment,
  runSandboxCommand,
} from '../src/adapters/isolation/sandbox.js';

test('tool environment contains no inherited authentication or service variables', () => {
  const env = minimalEnvironment('/isolated/home', '/isolated/tmp', '/runtime/bin');
  assert.equal(env.HOME, '/isolated/home');
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(env.PI_SESSION_FILE, undefined);
});
test('artifact collection rejects paths and symlinks outside workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eval-artifacts-'));
  try {
    await mkdir(join(root, 'workspace'));
    await writeFile(join(root, 'secret'), 'synthetic secret');
    await symlink(join(root, 'secret'), join(root, 'workspace/snapshot.yml'));
    await assert.rejects(safeFile(join(root, 'workspace'), 'snapshot.yml'), /escaped/);
    await assert.rejects(safeFile(join(root, 'workspace'), '../secret'), /escaped/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test(
  'cancelled acceptance does not dispatch and an in-flight command is killed promptly',
  { skip: process.platform !== 'darwin' },
  async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'eval-cancel-')));
    try {
      const profile = join(root, 'sandbox.sb');
      await writeFile(
        profile,
        sandboxProfile({
          workspace: root,
          writableDirectories: [root],
          readableDirectories: ['/bin', '/usr', '/System'],
          readableFiles: [],
          port: 59999,
        }),
      );
      const env = minimalEnvironment(root, root, '/usr/bin');
      let spawned = false;
      const skipped = await runSandboxCommand(profile, '/bin/sleep', ['10'], {
        cwd: root,
        env,
        signal: AbortSignal.abort(),
        onSpawn: () => {
          spawned = true;
        },
      });
      assert.equal(spawned, false);
      assert.equal(skipped.exitCode, null);
      assert.match(skipped.stderr, /cancelled before dispatch/);

      const controller = new AbortController();
      let pid: number | undefined;
      const started = Date.now();
      const running = await runSandboxCommand(profile, '/bin/sleep', ['10'], {
        cwd: root,
        env,
        timeoutMs: 12_000,
        signal: controller.signal,
        onSpawn: (child) => {
          pid = child;
          setTimeout(() => controller.abort(), 100);
        },
      });
      assert.equal(running.exitCode, null);
      assert.match(running.stderr, /cancelled by user/);
      assert.ok(Date.now() - started < 3000, 'Cancellation must not wait for command timeout.');
      assert.ok(pid);
      assert.throws(() => process.kill(pid!, 0), /ESRCH/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
test(
  'OS sandbox blocks an outside canary, write escape, and arbitrary network',
  { skip: process.platform !== 'darwin' },
  async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'eval-sandbox-')));
    let connected = false;
    const listener = createServer((socket) => {
      connected = true;
      socket.end('HTTP/1.1 200 OK\r\nContent-Length: 7\r\n\r\nCANARY!');
    });
    await new Promise<void>((resolveListen) => listener.listen(0, '127.0.0.1', resolveListen));
    const address = listener.address();
    assert.ok(address && typeof address !== 'string');
    try {
      const workspace = join(root, 'workspace');
      await mkdir(workspace);
      const outside = join(root, 'secret');
      await writeFile(outside, 'CANARY_NEVER_VISIBLE');
      const profile = join(root, 'sandbox.sb');
      await writeFile(
        profile,
        sandboxProfile({
          workspace,
          writableDirectories: [workspace],
          readableDirectories: ['/bin', '/usr', '/System'],
          readableFiles: [],
          port: address.port === 59999 ? 59998 : 59999,
        }),
      );
      const env = minimalEnvironment(workspace, workspace, '/usr/bin');
      const read = await runSandboxCommand(profile, '/bin/cat', [outside], { cwd: workspace, env });
      assert.notEqual(read.exitCode, 0);
      assert.ok(!read.stdout.includes('CANARY_NEVER_VISIBLE'));
      const write = await runSandboxCommand(
        profile,
        '/bin/bash',
        ['-c', `echo changed > '${outside}'`],
        { cwd: workspace, env },
      );
      assert.notEqual(write.exitCode, 0);
      assert.equal(await readFile(outside, 'utf8'), 'CANARY_NEVER_VISIBLE');
      const network = await runSandboxCommand(
        profile,
        '/usr/bin/curl',
        ['--max-time', '2', `http://127.0.0.1:${address.port}`],
        { cwd: workspace, env },
      );
      assert.notEqual(network.exitCode, 0);
      assert.equal(connected, false);
      assert.match(network.stderr, /not permitted|denied/i);
      const allowed = await runSandboxCommand(
        profile,
        '/bin/bash',
        ['-c', 'echo allowed > result.txt && cat result.txt'],
        { cwd: workspace, env },
      );
      assert.equal(allowed.exitCode, 0, allowed.stderr);
      assert.equal(allowed.stdout.trim(), 'allowed');
    } finally {
      await new Promise<void>((resolveClose, reject) =>
        listener.close((error) => (error ? reject(error) : resolveClose())),
      );
      await rm(root, { recursive: true, force: true });
    }
  },
);

test('only unambiguous native CLI commands receive an execution receipt', async () => {
  const { parseDirectPlaywright } = await import(
    new URL('../src/adapters/isolation/pi-tool-boundary.mjs', import.meta.url).href
  );
  assert.deepEqual(parseDirectPlaywright('playwright-cli -s=trial snapshot'), [
    '-s=trial',
    'snapshot',
  ]);
  for (const command of [
    'echo playwright-cli snapshot',
    'playwright-cli snapshot && echo fake',
    'playwright-cli snapshot\ncat answer',
    'playwright-cli open $(cat secret)',
    'playwright-cli open --config=mutable.json',
  ])
    assert.equal(parseDirectPlaywright(command), null);
});

test('malformed registry cleanup cannot retain private authentication or model configuration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eval-cleanup-'));
  const credentials = ['auth.json', 'models.json', 'models-store.json'].map((name) =>
    join(root, name),
  );
  try {
    await Promise.all(
      credentials.map((path) => writeFile(path, 'synthetic private configuration')),
    );
    await writeFile(join(root, 'process-groups.jsonl'), '{partial interrupted record');
    await assert.rejects(
      cleanupPrivateTrial(credentials, async () => {
        JSON.parse(await readFile(join(root, 'process-groups.jsonl'), 'utf8'));
      }),
      SyntaxError,
    );
    for (const path of credentials) await assert.rejects(access(path));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
