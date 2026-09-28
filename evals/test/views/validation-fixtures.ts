import type { RecordedTrial, TraceEvent } from 'agent-evals';

export const originalHash = '1'.repeat(64);
export const finalHash = '2'.repeat(64);

export function event(
  id: string,
  sequence: number,
  type: TraceEvent['type'],
  data: Record<string, unknown>,
  actor: TraceEvent['actor'] = 'agent',
): TraceEvent {
  return {
    id,
    sequence,
    type,
    data,
    actor,
    timestamp: `2026-09-27T00:00:${String(sequence).padStart(2, '0')}Z`,
  };
}

export function say(sequence: number, value: string) {
  return event(`message-${sequence}`, sequence, 'message', {
    role: 'assistant',
    text: value,
  });
}

export function tool(
  sequence: number,
  name: string,
  args: Record<string, unknown>,
  receipt: Record<string, unknown>,
  success = true,
  output = 'Observed tool output',
  actor: TraceEvent['actor'] = 'agent',
): TraceEvent[] {
  return [
    event(
      `call-${sequence}`,
      sequence,
      'tool-call',
      { callId: `tool-${sequence}`, name, args },
      actor,
    ),
    event(
      `result-${sequence}`,
      sequence + 1,
      'tool-result',
      {
        callId: `tool-${sequence}`,
        success,
        text: output,
        receipt,
        truncated: false,
      },
      actor,
    ),
  ];
}

export function edit(sequence: number, before = originalHash, after = finalHash) {
  return tool(
    sequence,
    'edit',
    { path: 'src/login.ts' },
    {
      kind: 'file-edit',
      path: 'src/login.ts',
      targetBeforeHash: before,
      targetAfterHash: after,
    },
  );
}

export function verify(
  sequence: number,
  command = 'pnpm test',
  revision = finalHash,
  exitCode = 0,
  actor: TraceEvent['actor'] = 'agent',
) {
  return tool(
    sequence,
    'bash',
    { command },
    {
      kind: 'bash',
      exitCode,
      targetBeforeHash: revision,
      targetAfterHash: revision,
    },
    exitCode === 0,
    exitCode === 0 ? 'Tests passed' : 'Expected enabled, received disabled',
    actor,
  );
}

export function trial(events: TraceEvent[] = []): RecordedTrial {
  return {
    id: 'recording-1',
    task: {
      id: 'login-retry',
      version: 1,
      prompt: 'Investigate why a failed login prevents another attempt. Repair retry behavior.',
      metadata: {
        diagnosis: 'required',
        validation: {
          required: true,
          targetFile: 'src/login.ts',
          requiredChecks: ['test'],
        },
      },
    },
    status: 'completed',
    trace: {
      events,
      artifacts: [
        {
          id: 'final-source',
          path: 'src/login.ts',
          content: 'fixed source',
          sha256: finalHash,
        },
      ],
      contexts: [],
      complete: true,
      gaps: [],
    },
    outcome: { localUrl: 'http://127.0.0.1:3456' },
    metadata: {},
  };
}
