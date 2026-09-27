import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Task } from '../domain/types.ts';
import { DEFAULT_TRIAL_LIMITS, MAX_RUNTIME_MS } from '../domain/trial-limits.ts';

const positiveInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const runtimeLimit = positiveInteger.max(MAX_RUNTIME_MS);
const trialLimitsSchema = z
  .object({
    runtimeMs: runtimeLimit.optional(),
    maxTurns: positiveInteger.optional(),
    maxTokens: positiveInteger.optional(),
  })
  .strict();

const identifier = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use a lowercase name such as ui-copy');
const relativeFile = z
  .string()
  .refine(
    (value) =>
      value.length > 0 &&
      !path.isAbsolute(value) &&
      !value.includes('\\') &&
      value.split('/').every((part) => part !== '.' && part !== '..' && /^[\w.-]+$/.test(part)),
    'Use a file path inside the repository, without .. or absolute paths',
  );

export const taskSchema = z
  .object({
    id: identifier,
    title: z.string().min(1).optional(),
    version: z.string().min(1),
    environment: z.literal('repository'),
    repository: z
      .object({ revision: z.string().regex(/^[a-f0-9]{40}$/, 'Pin a complete Git revision') })
      .strict(),
    acceptance: z.literal('admin-login-retry'),
    prompt: z.string().min(1),
    limits: trialLimitsSchema.optional(),
    targetFile: relativeFile,
    expectedText: z.string().min(1),
    flowPath: z
      .string()
      .refine(
        (value) =>
          value.startsWith('/') &&
          !value.startsWith('//') &&
          !value.includes('\\') &&
          !value.split('/').includes('..'),
        'Use a local URL path such as / or /schedule',
      ),
  })
  .strict();

export type TaskDefinition = Task & z.infer<typeof taskSchema>;

export const profileSchema = z
  .object({
    id: z.string().min(1),
    pi: z
      .object({
        runtime: z.literal('native'),
        model: z.string().trim().min(1).optional(),
        endpoint: z.enum(['native', 'catalog']).optional(),
      })
      .strict()
      .default({ runtime: 'native' }),
    runtimeMs: runtimeLimit.default(DEFAULT_TRIAL_LIMITS.runtimeMs),
    maxAgentTurns: positiveInteger.default(DEFAULT_TRIAL_LIMITS.maxTurns),
    maxAgentTokens: positiveInteger.default(DEFAULT_TRIAL_LIMITS.maxTokens),
    agentBilling: z.enum(['subscription', 'api']),
    maxAgentEstimatedCostUsd: z.number().positive().nullable(),
  })
  .strict()
  .superRefine((profile, context) => {
    const valid =
      profile.agentBilling === 'subscription'
        ? profile.maxAgentEstimatedCostUsd === null
        : profile.maxAgentEstimatedCostUsd !== null;
    if (!valid)
      context.addIssue({
        code: 'custom',
        path: ['maxAgentEstimatedCostUsd'],
        message:
          profile.agentBilling === 'subscription'
            ? 'Subscription Pi uses token/runtime bounds; its dollar threshold must be null'
            : 'API-billed Pi requires an explicit dollar threshold',
      });
  });

export type EvaluationProfile = z.infer<typeof profileSchema>;
export async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`Invalid JSON in ${file}: ${error.message}`);
    throw error;
  }
}

function parseConfiguration<T>(schema: z.ZodType<T>, value: unknown, file: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || 'configuration'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid evaluation configuration: ${file}\n${details}`);
  }
  return parsed.data;
}

export async function catalogNames(repo: string, kind: 'tasks' | 'profiles'): Promise<string[]> {
  return (await readdir(path.join(repo, 'evals', kind)))
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -5))
    .sort();
}

async function catalogFile(
  repo: string,
  kind: 'tasks' | 'profiles',
  name: string,
): Promise<string> {
  const names = await catalogNames(repo, kind);
  if (!identifier.safeParse(name).success || !names.includes(name)) {
    throw new Error(
      `Unknown ${kind === 'tasks' ? 'task' : 'profile'} "${name}". Available: ${names.join(', ')}.`,
    );
  }
  return path.join(repo, 'evals', kind, `${name}.json`);
}

/** Catalog files select resources; they never provide executable shell commands. */
export async function loadTask(repo: string, name: string): Promise<TaskDefinition> {
  const file = await catalogFile(repo, 'tasks', name);
  const task = parseConfiguration(taskSchema, await readJson(file), file);
  if (task.id !== name)
    throw new Error(`Task id "${task.id}" must match its filename ${name}.json`);
  const revision = task.repository!.revision;
  try {
    const kind = execFileSync('git', ['cat-file', '-t', `${revision}:${task.targetFile}`], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    if (kind !== 'blob') throw new Error('Target is not a file');
    const entry = execFileSync('git', ['ls-tree', revision, '--', task.targetFile], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (!/^100(?:644|755) blob /.test(entry)) throw new Error('Target must be a regular file');
  } catch {
    throw new Error(
      `Repository target must be a regular file at the pinned revision: ${task.targetFile}`,
    );
  }
  return task;
}

export async function loadProfile(repo: string, name = 'smoke'): Promise<EvaluationProfile> {
  const file = await catalogFile(repo, 'profiles', name);
  return parseConfiguration(profileSchema, await readJson(file), file);
}

export function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function treeHash(directory: string): Promise<string> {
  const records: string[] = [];
  async function visit(folder: string): Promise<void> {
    const entries = (await readdir(folder, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      if (entry.name === 'node_modules') continue;
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile())
        records.push(`${path.relative(directory, file)}:${hashText(await readFile(file, 'utf8'))}`);
      else throw new Error(`Unexpected symlink in versioned evaluation input: ${file}`);
    }
  }
  await visit(directory);
  return hashText(records.join('\n'));
}
