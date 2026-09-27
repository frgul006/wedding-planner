import { execFileSync } from 'node:child_process';
import path from 'node:path';

/** Resolve the original checkout when native resources come from a worktree. */
export function resolveSourceRepo(repo: string): string {
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();
  return path.dirname(common);
}
export function redact(text: string): string {
  return text
    .replace(/\bsk-[A-Za-z0-9_-]{12,}/g, '[REDACTED_API_KEY]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_JWT]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~-]+/gi, '$1[REDACTED]');
}
export function safeError(error: unknown): string {
  // SDK errors may include entire HTTP requests. Never stringify error objects.
  return redact(error instanceof Error ? error.message : 'Unknown error').slice(0, 1500);
}
