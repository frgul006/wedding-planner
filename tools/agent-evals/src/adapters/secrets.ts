import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

/** Worktrees resolve the original checkout; never copy the grader env into a trial. */
export function defaultEnvFile(repo: string): string {
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();
  return path.join(path.dirname(common), '.env.evals.local');
}
export async function loadGraderKey(file: string): Promise<string> {
  const parsed = parseEnv(await readFile(file, 'utf8'));
  if (!parsed.OPENAI_API_KEY?.trim()) throw new Error(`OPENAI_API_KEY missing in ${file}`);
  return parsed.OPENAI_API_KEY.trim();
}
export function redact(text: string, secrets: readonly string[] = []): string {
  let result = text;
  for (const secret of secrets.filter((s) => s.length > 6))
    result = result.split(secret).join('[REDACTED]');
  return result
    .replace(/\bsk-[A-Za-z0-9_-]{12,}/g, '[REDACTED_API_KEY]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_JWT]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~-]+/gi, '$1[REDACTED]');
}
export function safeError(error: unknown): string {
  // SDK errors may include entire HTTP requests. Never stringify error objects.
  return redact(error instanceof Error ? error.message : 'Unknown error').slice(0, 1500);
}
