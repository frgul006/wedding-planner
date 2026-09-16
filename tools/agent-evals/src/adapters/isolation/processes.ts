import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import type { TrialPaths } from './trial-paths.ts';

export async function reserveLocalPort(): Promise<number> {
  const listener = createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const address = listener.address();
  if (!address || typeof address === 'string')
    throw new Error('Cannot allocate local fixture port');
  await new Promise<void>((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

/** Tracks evaluator children and the boundary's separate registry of agent tools. */
export class TrialProcesses {
  private readonly evaluatorGroups = new Set<number>();
  constructor(private readonly registryPath: string) {}

  async initialize(): Promise<void> {
    await writeFile(this.registryPath, '');
  }
  readonly register = (pid: number): void => {
    this.evaluatorGroups.add(pid);
  };

  async startFixture(
    paths: TrialPaths,
    nodeExecutable: string,
    env: Record<string, string>,
    url: string,
  ): Promise<void> {
    const server = spawn(
      '/usr/bin/sandbox-exec',
      ['-f', paths.profile, nodeExecutable, join(paths.workspace, 'scripts/server.mjs')],
      {
        cwd: paths.workspace,
        env,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    if (server.pid) this.register(server.pid);
    let errors = '';
    server.stderr.on('data', (chunk) => {
      errors = (errors + String(chunk)).slice(-16_000);
    });
    server.on('error', (error) => {
      errors += error.message;
    });
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        if ((await fetch(url, { signal: AbortSignal.timeout(500) })).ok) return;
      } catch {
        /* A starting server may not have bound the loopback port yet. */
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(
      `Isolated fixture server did not start: ${errors || 'No successful local response'}`,
    );
  }

  async startRepository(
    paths: TrialPaths,
    nodeExecutable: string,
    env: Record<string, string>,
    url: string,
    signal?: AbortSignal,
  ): Promise<void> {
    signal?.throwIfAborted();
    const server = spawn(
      '/usr/bin/sandbox-exec',
      [
        '-f',
        paths.profile,
        nodeExecutable,
        join(paths.workspace, 'node_modules/next/dist/bin/next'),
        'dev',
        '--webpack',
        '--hostname',
        '127.0.0.1',
        '--port',
        new URL(url).port,
      ],
      { cwd: paths.workspace, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    if (server.pid) this.register(server.pid);
    let output = '';
    for (const stream of [server.stdout, server.stderr])
      stream.on('data', (chunk) => {
        output = (output + String(chunk)).slice(-24_000);
      });
    server.on('error', (error) => {
      output += error.message;
    });
    for (let attempt = 0; attempt < 120; attempt++) {
      signal?.throwIfAborted();
      try {
        if (
          (
            await fetch(url + '/admin/login', {
              signal: AbortSignal.any([AbortSignal.timeout(1000), ...(signal ? [signal] : [])]),
            })
          ).ok
        )
          return;
      } catch {
        /* Compile the real route before admitting an agent. */
      }
      signal?.throwIfAborted();
      if (server.exitCode !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Real Wedding Next.js server did not become ready: ${output}`);
  }

  async stop(): Promise<void> {
    const groups = new Set(this.evaluatorGroups);
    let malformed = false;
    try {
      for (const line of (await readFile(this.registryPath, 'utf8')).split('\n').filter(Boolean)) {
        try {
          const { pid } = JSON.parse(line) as { pid: number };
          if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid)
            throw new Error('Invalid child group');
          groups.add(pid);
        } catch {
          malformed = true;
        }
      }
    } finally {
      // A corrupt registry must not keep the known fixture/evaluator children alive.
      for (const pid of groups) {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          /* The group already exited. */
        }
      }
      this.evaluatorGroups.clear();
      await writeFile(this.registryPath, '');
    }
    if (malformed)
      throw new Error('Malformed process registry; some child groups could not be identified.');
  }
}
