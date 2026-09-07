import { access, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Grade, TrialEvidence } from '../domain/types.ts';
import { normalizeLegacyEvidence } from './pi-evidence.ts';
import { FileRunStore, hash } from './file-run-store.ts';
import { readJson } from './evaluation-config.ts';

const gradeSchema = z.object({
  grader: z.string(),
  version: z.string(),
  verdict: z.enum(['pass', 'fail', 'unknown', 'not-applicable']),
  reason: z.string(),
  evidenceRefs: z.array(z.string()),
});
const manifestSchema = z
  .object({
    id: z.string().optional(),
    status: z.string().optional(),
    variant: z.string().optional(),
    startedAt: z.string().optional(),
    invariants: z.unknown().optional(),
    comparisonEligible: z.boolean().optional(),
  })
  .passthrough();

export type SavedManifest = z.infer<typeof manifestSchema>;
export interface RunSummary {
  id: string;
  directory: string;
  status: string;
  variant: string;
  startedAt: string;
  task: string;
  warning?: string;
}
export interface GradingRevision {
  id: string;
  label: string;
  grades: Grade[];
  gradedAt?: string;
  harnessHash?: string;
  semantic?: unknown;
  budget?: unknown;
  criteria?: unknown;
  reportPath: string;
}
export interface InvalidGradingRevision {
  id: string;
  reason: string;
}
export interface SavedRun {
  directory: string;
  id: string;
  manifest: SavedManifest;
  evidence: TrialEvidence;
  integrityHash: string;
  original: GradingRevision;
  regrades: GradingRevision[];
  invalidRegrades: InvalidGradingRevision[];
  warnings: string[];
}

const isMissing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';

export async function listRuns(repo: string): Promise<RunSummary[]> {
  const root = path.join(repo, 'evals/runs');
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  const runs: RunSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(root, entry.name);
    try {
      const manifest = manifestSchema.parse(await readJson(path.join(directory, 'manifest.json')));
      let task = 'unknown';
      try {
        const evidence = (await readJson(path.join(directory, 'evidence.json'))) as {
          task?: { id?: string };
        };
        task = evidence.task?.id ?? task;
      } catch {
        /* Failed preparation may have only its initial manifest. */
      }
      runs.push({
        id: manifest.id ?? entry.name,
        directory,
        status: manifest.status ?? 'unknown',
        variant: manifest.variant ?? 'unknown',
        startedAt: manifest.startedAt ?? '',
        task,
      });
    } catch (error) {
      if (!isMissing(error))
        runs.push({
          id: entry.name,
          directory,
          status: 'unreadable',
          variant: 'unknown',
          startedAt: '',
          task: 'unknown',
          warning: 'Cannot read this trial manifest',
        });
    }
  }
  return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id));
}

/** Accept a run ID, latest, an absolute path, or a path relative to the caller. */
export async function resolveRun(
  repo: string,
  reference: string,
  callerCwd: string,
): Promise<string> {
  if (reference === 'latest') {
    const runs = await listRuns(repo);
    const latest = runs.find((run) => run.status !== 'unreadable');
    if (!latest)
      throw new Error('No saved trials yet. Start with pnpm evals run ui-copy --no-grader.');
    return latest.directory;
  }
  const candidates = path.isAbsolute(reference)
    ? [reference]
    : [
        path.resolve(callerCwd, reference),
        path.resolve(repo, reference),
        path.join(repo, 'evals/runs', reference),
      ];
  for (const candidate of new Set(candidates)) {
    try {
      if ((await stat(candidate)).isDirectory()) {
        await access(path.join(candidate, 'manifest.json'));
        return candidate;
      }
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  throw new Error(
    `Saved trial "${reference}" was not found. Run pnpm evals runs to see available IDs.`,
  );
}

export async function verifyIntegrity(directory: string): Promise<string> {
  let raw: string;
  try {
    raw = await readFile(path.join(directory, 'integrity.json'), 'utf8');
  } catch (error) {
    if (isMissing(error))
      throw new Error(
        `Trial evidence is not sealed: ${directory}. Preparation may have failed; inspect manifest.json before retrying.`,
      );
    throw error;
  }
  const seal = z
    .object({ files: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)) })
    .parse(JSON.parse(raw));
  for (const [name, expected] of Object.entries(seal.files)) {
    if (
      !/^[\w.-]+$/.test(name) ||
      hash(await readFile(path.join(directory, name), 'utf8')) !== expected
    ) {
      throw new Error(
        `Evidence integrity check failed: ${name}. Original evidence was changed; do not use this run for conclusions.`,
      );
    }
  }
  if (!seal.files['evidence.json'] || !seal.files['manifest.json'])
    throw new Error('Incomplete evidence integrity manifest');
  return hash(raw);
}

function validateEvidence(value: unknown): TrialEvidence {
  // Keep raw native envelopes and adapter metadata intact. Validate the outer
  // contract before passing data to the versioned native-evidence normalizer.
  const record = z.record(z.string(), z.unknown());
  const schema = z.object({
    task: z
      .object({
        id: z.string(),
        version: z.string(),
        kind: z.enum(['ui', 'docs']),
        prompt: z.string(),
        targetFile: z.string(),
        expectedText: z.string(),
        flowPath: z.string(),
      })
      .passthrough(),
    variant: z.enum(['enabled', 'disabled']),
    localUrl: z.string(),
    artifacts: z.array(
      z.object({
        id: z.string(),
        path: z.string(),
        sha256: z.string(),
        content: z.string(),
        observedBy: z.literal('evaluator'),
      }),
    ),
    events: z.array(
      z
        .object({
          id: z.string(),
          sequence: z.number(),
          timestamp: z.string(),
          actor: z.enum(['agent', 'environment', 'evaluator']),
          kind: z.enum(['pi', 'command', 'lifecycle']),
          data: record,
        })
        .passthrough(),
    ),
    agent: z
      .object({
        status: z.enum([
          'completed',
          'cancelled',
          'timeout',
          'budget_exceeded',
          'infrastructure_error',
          'agent_error',
        ]),
        startedAt: z.string(),
        endedAt: z.string(),
        exitCode: z.number().nullable(),
        signal: z.string().nullable(),
        usage: z.object({
          inputTokens: z.number(),
          outputTokens: z.number(),
          cacheReadTokens: z.number(),
          cacheWriteTokens: z.number(),
          estimatedCostUsd: z.number().nullable(),
          costSource: z.string(),
        }),
        model: record.nullable(),
        thinkingLevel: z.string().nullable(),
        events: z.array(
          z
            .object({
              id: z.string(),
              sequence: z.number(),
              timestamp: z.string(),
              actor: z.enum(['agent', 'environment', 'evaluator']),
              kind: z.enum(['pi', 'command', 'lifecycle']),
              data: record,
            })
            .passthrough(),
        ),
        error: z.string().optional(),
      })
      .passthrough(),
  });
  return schema.parse(value) as TrialEvidence;
}

/** Include orphaned companion files so an interrupted latest revision cannot disappear. */
function gradingRevisionIds(files: string[]): string[] {
  return [
    ...new Set(
      files.flatMap((file) => {
        const match = /^(regrade-.+?)(?:\.integrity\.json|\.json|\.md)$/.exec(file);
        return match ? [match[1]] : [];
      }),
    ),
  ].sort();
}

async function readGradingRevision(
  directory: string,
  id: string,
  sourceIntegrityHash: string,
): Promise<{ revision: GradingRevision; warning?: string }> {
  const json = await readFile(path.join(directory, `${id}.json`), 'utf8');
  const reportPath = path.join(directory, `${id}.md`);
  const markdown = await readFile(reportPath, 'utf8');
  const revision = z
    .object({
      grades: z.array(gradeSchema),
      sourceIntegrityHash: z.string(),
      harnessHash: z.string(),
      regradedAt: z.string(),
      semantic: z.unknown().optional(),
      budget: z.unknown().optional(),
      criteria: z.unknown().optional(),
    })
    .parse(JSON.parse(json));
  if (revision.sourceIntegrityHash !== sourceIntegrityHash)
    throw new Error('Regrade refers to different source evidence.');

  let seal: { json: string; markdown: string } | undefined;
  try {
    const rawSeal = await readFile(path.join(directory, `${id}.integrity.json`), 'utf8');
    seal = z.object({ json: z.string(), markdown: z.string() }).parse(JSON.parse(rawSeal));
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  if (seal && (seal.json !== hash(json) || seal.markdown !== hash(markdown)))
    throw new Error('Regrade integrity check failed.');

  return {
    revision: {
      id,
      label: id,
      grades: revision.grades,
      gradedAt: revision.regradedAt,
      harnessHash: revision.harnessHash,
      semantic: revision.semantic,
      budget: revision.budget,
      criteria: revision.criteria,
      reportPath,
    },
    warning: seal
      ? undefined
      : `${id} has no revision integrity seal; source integrity is verified, but appended grading is unsealed. Run regrade to create a sealed revision.`,
  };
}

function invalidRevisionReason(error: unknown): string {
  if (isMissing(error)) return 'Revision JSON or Markdown report is missing.';
  if (error instanceof SyntaxError)
    return 'Revision JSON or integrity metadata is incomplete or invalid.';
  if (error instanceof z.ZodError)
    return 'Revision metadata does not match the saved grading format.';
  if (error instanceof Error && error.message.startsWith('Regrade ')) return error.message;
  return 'Revision files could not be read.';
}

export async function readSavedRun(directory: string): Promise<SavedRun> {
  const integrityHash = await verifyIntegrity(directory);
  const seal = z
    .object({ files: z.record(z.string(), z.string()) })
    .parse(await readJson(path.join(directory, 'integrity.json')));
  if (!seal.files['grades.json'])
    throw new Error('Original grades.json is missing from the evidence integrity seal.');
  const manifest = manifestSchema.parse(await readJson(path.join(directory, 'manifest.json')));
  const evidence = normalizeLegacyEvidence(
    validateEvidence(await readJson(path.join(directory, 'evidence.json'))),
  );
  const id = manifest.id ?? path.basename(directory);
  const grades = z.array(gradeSchema).parse(await readJson(path.join(directory, 'grades.json')));
  let semantic: unknown;
  try {
    semantic = await readJson(path.join(directory, 'semantic.json'));
    if (!seal.files['semantic.json'])
      throw new Error('Original semantic.json is missing from the evidence integrity seal.');
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  const original: GradingRevision = {
    id: 'original',
    label: 'Original grading',
    grades,
    semantic,
    reportPath: path.join(directory, 'report.md'),
  };
  const warnings: string[] = [];
  const regrades: GradingRevision[] = [];
  const invalidRegrades: InvalidGradingRevision[] = [];
  for (const revisionId of gradingRevisionIds(await readdir(directory))) {
    try {
      const { revision, warning } = await readGradingRevision(directory, revisionId, integrityHash);
      regrades.push(revision);
      if (warning) warnings.push(warning);
    } catch (error) {
      invalidRegrades.push({ id: revisionId, reason: invalidRevisionReason(error) });
    }
  }
  return {
    id,
    directory,
    manifest,
    evidence,
    integrityHash,
    original,
    regrades,
    invalidRegrades,
    warnings,
  };
}

/** Revisions are selected as a whole; semantic judgments are never silently merged. */
export function selectGrading(run: SavedRun, selector = 'latest'): GradingRevision {
  if (selector === 'original') return run.original;
  const selectedId =
    selector === 'latest'
      ? [...run.regrades, ...run.invalidRegrades]
          .map((revision) => revision.id)
          .sort()
          .at(-1)
      : selector;
  if (selectedId === undefined) return run.original;
  const invalid = run.invalidRegrades.find((revision) => revision.id === selectedId);
  if (invalid)
    throw new Error(
      `Grading revision "${invalid.id}" is invalid: ${invalid.reason} Select original to inspect the sealed trial, or run regrade to create a new revision.`,
    );
  const revision = run.regrades.find((item) => item.id === selectedId);
  if (!revision)
    throw new Error(
      `Unknown grading revision "${selector}" for ${run.id}. Use original, latest, or an ID from pnpm evals show ${run.id}.`,
    );
  return revision;
}

export async function sealRegrade(store: FileRunStore, name: string): Promise<void> {
  const json = hash(await readFile(path.join(store.directory, `${name}.json`), 'utf8'));
  const markdown = hash(await readFile(path.join(store.directory, `${name}.md`), 'utf8'));
  await store.save(`${name}.integrity.json`, { algorithm: 'sha256', json, markdown });
}
