import { spawn } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

export interface SandboxConfiguration {
  workspace: string;
  writableDirectories: string[];
  readableDirectories: string[];
  readableFiles: string[];
  port: number;
}
const quoted = (value: string) => JSON.stringify(value);
export function sandboxProfile(config: SandboxConfiguration): string {
  if (process.platform !== 'darwin')
    throw new Error('The pilot requires macOS sandbox-exec; no unsandboxed fallback is permitted.');
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535)
    throw new Error('Invalid fixture port');
  return [
    '(version 1)',
    '(deny default)',
    '(allow process-exec process-fork)',
    '(allow signal (target same-sandbox))',
    '(allow sysctl-read)',
    '(allow mach-bootstrap)',
    '(allow mach-register (local-name-prefix "") (global-name-prefix "org.chromium.Chromium.MachPortRendezvousServer."))',
    '(allow mach-lookup (global-name-prefix "org.chromium.Chromium.MachPortRendezvousServer."))',
    '(allow iokit-open-service (iokit-registry-entry-class "IOPMrootDomain"))',
    '(allow iokit-open-user-client (iokit-user-client-class "RootDomainUserClient"))',
    '(allow mach-lookup (global-name "com.apple.cfprefsd.agent") (global-name "com.apple.cfprefsd.daemon") (global-name "com.apple.system.logger") (global-name "com.apple.FontObjectsServer"))',
    '(allow file-read-metadata)',
    '(allow file-read* (literal "/"))',
    ...config.readableDirectories.map((path) => `(allow file-read* (subpath ${quoted(path)}))`),
    ...config.readableFiles.map((path) => `(allow file-read* (literal ${quoted(path)}))`),
    ...config.writableDirectories.map(
      (path) => `(allow file-read* file-write* (subpath ${quoted(path)}))`,
    ),
    '(allow file-read* file-write* (literal "/dev/null") (literal "/dev/tty") (literal "/dev/random") (literal "/dev/urandom"))',
    // The browser communicates over pipes; the CLI daemon uses a Unix socket under the trial's temp directory.
    ...config.writableDirectories.map((path) => `(allow network* (subpath ${quoted(path)}))`),
    `(allow network-outbound (remote ip "localhost:${config.port}"))`,
    `(allow network-bind network-inbound (local ip "localhost:${config.port}"))`,
  ].join('\n');
}
export function isWithin(root: string, path: string): boolean {
  const child = relative(root, path);
  return child === '' || (!child.startsWith('..' + '/') && child !== '..' && !isAbsolute(child));
}
/** Used for artifact capture; rejects escapes, including symlinks. The OS profile enforces tool access separately. */
export async function safeFile(root: string, path: string): Promise<string> {
  const actual = await realpath(resolve(root, path));
  if (!isWithin(await realpath(root), actual) || !(await stat(actual)).isFile())
    throw new Error('Artifact escaped the trial workspace');
  return actual;
}
export function minimalEnvironment(
  home: string,
  temporary: string,
  runtimeBin: string,
): Record<string, string> {
  return {
    HOME: home,
    TMPDIR: temporary + '/',
    PATH: `${runtimeBin}:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin`,
    OPENSSL_CONF: '/dev/null',
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
    CI: '1',
    TERM: 'dumb',
    XDG_CACHE_HOME: resolve(home, '.cache'),
    XDG_CONFIG_HOME: resolve(home, '.config'),
    GIT_CONFIG_NOSYSTEM: '1',
    COREPACK_ENABLE_NETWORK: '0',
    NO_COLOR: '1',
  };
}
export interface SandboxCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}
export async function runSandboxCommand(
  profilePath: string,
  executable: string,
  args: string[],
  options: {
    cwd: string;
    env: Record<string, string>;
    timeoutMs?: number;
    input?: string;
    onSpawn?: (pid: number) => void;
  },
): Promise<SandboxCommandResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn('/usr/bin/sandbox-exec', ['-f', profilePath, executable, ...args], {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (child.pid) options.onSpawn?.(child.pid);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    const timer = setTimeout(() => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {}
    }, options.timeoutMs ?? 15_000);
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolveResult({ stdout, stderr, exitCode });
    });
    child.stdin.end(options.input);
  });
}
export async function resolveExecutable(executable: string): Promise<string> {
  for (const directory of (process.env.PATH ?? '').split(':')) {
    try {
      const candidate = isAbsolute(executable) ? executable : resolve(directory, executable);
      return await realpath(candidate);
    } catch {
      /* try next */
    }
  }
  throw new Error(`Required executable unavailable: ${executable}`);
}
export function runtimeRoot(executable: string): string {
  return dirname(dirname(executable));
}
