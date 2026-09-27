import type { PreparedItem, RecordedTrial } from '../../src/index.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileStore } from '../../src/adapters/files.ts';

export const trial = (id = 'trial-example'): RecordedTrial => ({
  id,
  task: { id: 'bug', version: 1, prompt: 'Repair retry behavior' },
  status: 'completed',
  trace: {
    events: [
      {
        id: 'e1',
        sequence: 1,
        timestamp: '2026-09-27',
        actor: 'agent',
        type: 'message',
        data: {
          role: 'assistant',
          text: 'If the error disables the button, clearing it enables retry.',
        },
      },
    ],
    artifacts: [],
    contexts: [],
    complete: true,
    gaps: [],
  },
  outcome: {},
  metadata: {},
});

export const item = (id = 'episode'): PreparedItem<{ prediction: string }> => ({
  id,
  data: { prediction: 'Clearing the error enables retry' },
  scope: 'One diagnostic episode',
  sourceRefs: ['e1'],
  coverage: { complete: true, gaps: [] },
  omissions: [],
  applicability: 'applicable',
});

export const rubric = {
  pass: 'Observable disproof exists',
  fail: 'No observable disproof',
  unknown: 'Insufficient evidence',
};

export async function setup() {
  const folder = await mkdtemp(path.join(tmpdir(), 'eval-library-'));
  const store = fileStore(folder);
  await store.saveTrial(trial());
  return { folder, store, dispose: () => rm(folder, { recursive: true, force: true }) };
}
