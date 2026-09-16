import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Task } from '../domain/types.ts';

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
    'Use a file path inside the fixture, without .. or absolute paths',
  );

export const taskSchema = z
  .object({
    id: identifier,
    title: z.string().min(1).optional(),
    version: z.string().min(1),
    kind: z.enum(['ui', 'docs']),
    environment: z.enum(['synthetic', 'repository']).default('synthetic'),
    repository: z
      .object({ revision: z.string().regex(/^[a-f0-9]{40}$/, 'Pin a complete Git revision') })
      .strict()
      .optional(),
    acceptance: identifier.optional(),
    allowedChangedPaths: z.array(relativeFile).optional(),
    graders: z
      .array(identifier)
      .min(1)
      .refine((ids) => new Set(ids).size === ids.length, 'Grader IDs must be unique')
      .optional(),
    fixture: identifier.default('wedding-copy'),
    rubric: identifier.default('task-clarity'),
    prompt: z.string().min(1),
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
  .strict()
  .superRefine((task, context) => {
    if (task.environment === 'repository' && !task.repository)
      context.addIssue({
        code: 'custom',
        path: ['repository'],
        message: 'Repository tasks require a pinned revision',
      });
    if (
      task.environment === 'synthetic' &&
      !/\.(md|html|ya?ml|json|log|txt)$/.test(task.targetFile)
    )
      context.addIssue({
        code: 'custom',
        path: ['targetFile'],
        message: 'The synthetic fixture adapter captures md, html, yaml, json, log and txt targets',
      });
  });

export type TaskDefinition = Task & z.infer<typeof taskSchema>;

export const profileSchema = z
  .object({
    id: z.string().min(1),
    harness: identifier.default('pi'),
    concurrency: z.literal(1),
    pi: z
      .object({ runtime: z.enum(['native', 'controlled']) })
      .strict()
      .default({ runtime: 'native' }),
    runtimeMs: z.number().int().positive().max(900_000),
    maxAgentTokens: z.number().int().positive().max(1_500_000),
    agentBilling: z.enum(['subscription', 'api']),
    maxAgentEstimatedCostUsd: z.number().positive().max(0.95).nullable(),
    estimatedApiBudgetUsd: z.number().positive().max(1),
    agentRetries: z.literal(0),
    grader: z
      .object({
        model: z.string().min(1),
        reasoningEffort: z.literal('none'),
        maxOutputTokens: z.number().int().positive().max(1_200),
        maxInputChars: z.number().int().positive().max(24_000),
        timeoutMs: z.number().int().positive().max(30_000),
        maxRetries: z.literal(0),
        inputPerMillion: z.number().nonnegative(),
        outputPerMillion: z.number().nonnegative(),
        pricingSource: z.string().min(1),
        pricingCheckedOn: z.string().min(1),
      })
      .strict(),
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
export interface ProfileOverrides {
  budgetUsd?: string;
  graderModel?: string;
  graderInputPrice?: string;
  graderOutputPrice?: string;
}

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
      `Unknown ${kind === 'tasks' ? 'task' : 'profile'} "${name}". Available: ${names.join(', ')}.\nRun pnpm evals ${kind} to explore them.`,
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
  if (task.environment === 'repository') {
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
    await readFile(path.join(repo, 'evals/rubrics', `${task.rubric}.md`), 'utf8');
    return task;
  }
  const fixture = await realpath(path.join(repo, 'evals/fixtures', task.fixture));
  const fixtureRoot = await realpath(path.join(repo, 'evals/fixtures'));
  if (!fixture.startsWith(fixtureRoot + path.sep))
    throw new Error('Fixture must stay inside evals/fixtures');
  const target = await realpath(path.join(fixture, task.targetFile));
  if (
    !target.startsWith(fixture + path.sep) ||
    target !== path.resolve(fixture, task.targetFile) ||
    !(await stat(target)).isFile()
  ) {
    throw new Error(
      `Task target must be a regular file inside its fixture, without symlinks: ${task.targetFile}`,
    );
  }
  await readFile(path.join(repo, 'evals/rubrics', `${task.rubric}.md`), 'utf8');
  return task;
}

export async function loadProfile(
  repo: string,
  name = 'smoke',
  overrides: ProfileOverrides = {},
): Promise<EvaluationProfile> {
  const file = await catalogFile(repo, 'profiles', name);
  const profile = parseConfiguration(profileSchema, await readJson(file), file);
  if (overrides.budgetUsd !== undefined)
    profile.estimatedApiBudgetUsd = Number(overrides.budgetUsd);
  const hasInputPrice = overrides.graderInputPrice !== undefined;
  const hasOutputPrice = overrides.graderOutputPrice !== undefined;
  if (hasInputPrice !== hasOutputPrice)
    throw new Error('Provide both --grader-input-price and --grader-output-price.');
  if ((hasInputPrice || hasOutputPrice) && !overrides.graderModel)
    throw new Error('Price overrides require --grader-model.');
  if (overrides.graderModel) {
    if (overrides.graderModel !== profile.grader.model && !hasInputPrice) {
      throw new Error(
        'A different grader model requires --grader-input-price and --grader-output-price per million tokens. No fallback is automatic.',
      );
    }
    profile.grader.model = overrides.graderModel;
    if (hasInputPrice && hasOutputPrice) {
      profile.grader.inputPerMillion = Number(overrides.graderInputPrice);
      profile.grader.outputPerMillion = Number(overrides.graderOutputPrice);
      profile.grader.pricingSource = 'Explicit CLI price estimate';
      profile.grader.pricingCheckedOn = new Date().toISOString().slice(0, 10);
    }
  }
  return parseConfiguration(profileSchema, profile, file);
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
