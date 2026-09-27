import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  GradingRecord,
  JudgeRequest,
  RecordedTrial,
  Store,
  SuiteRun,
} from '../domain/library.ts';
import { contentHash, immutableCopy } from '../application/serialization.ts';

const safeId = (id: string) => {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,179}$/.test(id)) throw new Error('Invalid saved record ID');
  return id;
};
const json = (value: unknown) => JSON.stringify(value, null, 2);

export function renderGradingRecord(record: GradingRecord): string {
  const lines = [
    `# Grading ${record.id}`,
    '',
    `Trial: [${record.trialId}](../../trials/${record.trialId}.json)`,
    `Trial content hash: ${record.trialHash}`,
    `Created: ${record.createdAt}`,
    '',
    'Exact inputs, responses and metadata: [grading.json](grading.json)',
    '',
    '| Grader | Verdict | Pass | Fail | Unknown | Not applicable |',
    '| --- | --- | --- | --- | --- | --- |',
    ...record.rollups.map(
      (rollup) =>
        `| ${rollup.grader} | ${rollup.verdict} | ${rollup.counts.pass} | ${rollup.counts.fail} | ${rollup.counts.unknown} | ${rollup.counts.not_applicable} |`,
    ),
    '',
    record.rollups[0]?.rule ?? 'No graders selected.',
    '',
    'These item counts describe one trial; they are not independent agent attempts.',
    '',
  ];
  for (const grade of record.grades) {
    const evidenceIndex = record.evidence.findIndex((item) => item.id === grade.evidenceId);
    const job = record.jobs.find(
      (job) => job.grader.id === grade.grader.id && job.evidence.id === grade.evidenceId,
    );
    lines.push(
      `## ${grade.grader.id} · version ${grade.grader.version} · ${grade.verdict}`,
      '',
      `Execution: ${grade.status}`,
      evidenceIndex < 0
        ? `Evidence: ${grade.evidenceId} (not retained)`
        : `Evidence: [${grade.evidenceId}](#evidence-${evidenceIndex + 1})`,
      `Considered sources: ${grade.consideredRefs.join(', ') || '(none)'}`,
      `Explicit supporting sources: ${grade.supportingRefs?.join(', ') || '(none supplied)'}`,
      '',
      ...(grade.reason ? [grade.reason, ''] : []),
      ...(job
        ? [
            'Question and rubric:',
            '```json',
            json({ question: job.question, rubric: job.rubric }),
            '```',
            '',
          ]
        : []),
    );
  }
  for (const [index, evidence] of record.evidence.entries()) {
    lines.push(
      `## Evidence ${index + 1}`,
      '',
      'Exact prepared evidence:',
      '```json',
      json(evidence),
      '```',
      '',
    );
  }
  for (const entry of record.requests) {
    lines.push(
      `## Judge request ${entry.request.id}`,
      '',
      `Jobs: ${entry.request.jobIds.join(', ')}`,
      `Dispatch attempted: ${entry.dispatched ? 'yes' : 'no'}`,
      `Reserved estimate: $${entry.request.reservedCostUsd.toFixed(8)}`,
      `Observed estimate: ${(entry.response?.usage ?? entry.observedUsage)?.estimatedCostUsd == null ? 'unknown / no response' : '$' + (entry.response?.usage ?? entry.observedUsage)!.estimatedCostUsd!.toFixed(8)}`,
      ...(entry.error ? [`Error: ${entry.error}`] : []),
      '',
      'Prepared request body (credentials excluded):',
      '```json',
      json(entry.request.body),
      '```',
      '',
      'Provider response:',
      '```json',
      json(entry.response?.raw ?? entry.receivedResponse ?? null),
      '```',
      '',
    );
  }
  return lines.join('\n') + '\n';
}

/** All records are append-only. Hashes detect accidental edits, not malicious re-signing. */
export function fileStore(directory: string): Store & { directory: string } {
  const root = path.resolve(directory);
  async function save(file: string, value: unknown) {
    value = immutableCopy(value);
    const envelope = {
      serializationVersion: 'canonical-json-v1',
      contentHash: await contentHash(value),
      value,
    };
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, json(envelope) + '\n', { flag: 'wx', mode: 0o600 });
  }
  async function load<T>(file: string): Promise<T> {
    const envelope = JSON.parse(await readFile(file, 'utf8')) as {
      serializationVersion: string;
      contentHash: string;
      value: T;
    };
    if (
      envelope.serializationVersion !== 'canonical-json-v1' ||
      envelope.contentHash !== (await contentHash(envelope.value))
    )
      throw new Error('Saved record integrity check failed');
    return envelope.value;
  }
  return {
    directory: root,
    saveTrial: (trial) => save(path.join(root, 'trials', `${safeId(trial.id)}.json`), trial),
    async loadTrial(id) {
      const trial = await load<RecordedTrial>(path.join(root, 'trials', `${safeId(id)}.json`));
      if (trial.id !== id || !trial.trace || !Array.isArray(trial.trace.events))
        throw new Error('Invalid saved trial');
      return trial;
    },
    saveRun: (run) => save(path.join(root, 'runs', `${safeId(run.id)}.json`), run),
    async loadRun(id) {
      const run = await load<SuiteRun>(path.join(root, 'runs', `${safeId(id)}.json`));
      if (run.id !== id || !Array.isArray(run.trialIds)) throw new Error('Invalid saved run');
      return run;
    },
    async saveRequest(gradingId: string, request: JudgeRequest) {
      await save(
        path.join(root, 'gradings', safeId(gradingId), 'requests', `${safeId(request.id)}.json`),
        request,
      );
    },
    async saveGrading(record) {
      record = immutableCopy(record);
      const trial = await this.loadTrial(record.trialId);
      if ((await contentHash(trial)) !== record.trialHash)
        throw new Error('Grading refers to different trial content');
      const folder = path.join(root, 'gradings', safeId(record.id));
      await save(path.join(folder, 'grading.json'), record);
      await writeFile(path.join(folder, 'report.md'), renderGradingRecord(record), {
        flag: 'wx',
        mode: 0o600,
      });
    },
    async listGradings(trialId) {
      safeId(trialId);
      const folders = await readdir(path.join(root, 'gradings')).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return [];
          throw error;
        },
      );
      const records: GradingRecord[] = [];
      for (const name of folders.sort()) {
        const file = path.join(root, 'gradings', safeId(name), 'grading.json');
        let record: GradingRecord;
        try {
          record = await load<GradingRecord>(file);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            const pending = await readdir(path.join(root, 'gradings', name, 'requests')).catch(
              (readError: NodeJS.ErrnoException) => {
                // A crash can leave only the directory created before the first write.
                // With no journaled request there is no dispatch to associate with a trial.
                if (readError.code === 'ENOENT') return [];
                throw readError;
              },
            );
            const requests = await Promise.all(
              pending.map((file) =>
                load<JudgeRequest>(path.join(root, 'gradings', name, 'requests', file)),
              ),
            );
            if (requests.some((request) => request.metadata.trialId === trialId))
              throw new Error(
                `Incomplete grading ${name}; saved requests are retained for inspection`,
              );
            continue;
          }
          throw error;
        }
        if (record.trialId === trialId) records.push(record);
      }
      return records;
    },
  };
}
