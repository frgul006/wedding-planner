import { execFileSync } from 'node:child_process';
import path from 'node:path';

/** Native Pi resources and installed app dependencies come from the original checkout. */
export function resolveSourceRepo(repo: string): string {
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();
  return path.dirname(common);
}
