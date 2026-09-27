import { appendFileSync } from 'node:fs';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { redact } from '../redaction.ts';
import type { EvidenceEvent, RunStore } from './types.ts';

export const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export class FileRunStore implements RunStore {
  constructor(readonly directory: string) {}

  async save(name: string, value: unknown) {
    if (!/^[\w.-]+$/.test(name)) {
      throw new Error('Invalid evidence filename');
    }
    const body = typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n';
    await writeFile(path.join(this.directory, name), redact(body), { mode: 0o600 });
  }

  append(event: EvidenceEvent) {
    appendFileSync(
      path.join(this.directory, 'transcript.jsonl'),
      redact(JSON.stringify(event)) + '\n',
      { mode: 0o600 },
    );
  }

  async seal(names: string[]) {
    const digests: Record<string, string> = {};
    for (const name of names) {
      digests[name] = hash(await readFile(path.join(this.directory, name), 'utf8'));
    }
    await this.save('integrity.json', { algorithm: 'sha256', files: digests });
  }
}
