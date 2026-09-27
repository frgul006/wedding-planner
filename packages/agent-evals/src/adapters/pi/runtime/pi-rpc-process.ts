import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

export type JsonObject = Record<string, unknown>;

export const object = (value: unknown): JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {};

/** RPC 0.85 uses LF only. Unicode line separators inside JSON strings are valid. */
export class JsonlDecoder {
  private pending = '';
  private decoder = new StringDecoder('utf8');

  constructor(
    private readonly receive: (value: JsonObject) => void,
    private readonly maxRecordBytes = 16 * 1024 * 1024,
  ) {}

  push(chunk: Buffer): void {
    this.pending += this.decoder.write(chunk);
    let delimiter: number;
    while ((delimiter = this.pending.indexOf('\n')) !== -1) {
      const line = this.pending.slice(0, delimiter).replace(/\r$/, '');
      this.pending = this.pending.slice(delimiter + 1);
      if (Buffer.byteLength(line) > this.maxRecordBytes) {
        throw new Error('Pi RPC record exceeds evidence size limit');
      }
      if (!line) {
        continue;
      }
      const parsed: unknown = JSON.parse(line);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Pi RPC record must be an object');
      }
      this.receive(parsed as JsonObject);
    }
    if (Buffer.byteLength(this.pending) > this.maxRecordBytes) {
      throw new Error('Pi RPC incomplete record exceeds evidence size limit');
    }
  }

  finish(): void {
    this.pending += this.decoder.end();
    if (this.pending.trim()) {
      throw new Error('Pi RPC ended with an incomplete JSONL record');
    }
  }
}

/** Catalog objects may include custom-provider headers. Persist only model metadata. */
export function modelMetadata(value: unknown): JsonObject | null {
  const model = object(value);
  if (typeof model.id !== 'string' || typeof model.provider !== 'string') {
    return null;
  }
  const allowed = [
    'id',
    'name',
    'api',
    'provider',
    'reasoning',
    'input',
    'contextWindow',
    'maxTokens',
    'cost',
  ];
  return Object.fromEntries(allowed.filter((key) => key in model).map((key) => [key, model[key]]));
}

function safeRpcEvent(event: JsonObject): JsonObject {
  if (event.type !== 'response') {
    return event;
  }
  const data = object(event.data);
  if (event.command === 'get_state') {
    return { ...event, data: { ...data, model: modelMetadata(data.model) } };
  }
  if (event.command === 'get_available_models') {
    return {
      ...event,
      data: { models: Array.isArray(data.models) ? data.models.map(modelMetadata) : [] },
    };
  }
  return event;
}

export class RpcProcess {
  readonly child: ChildProcessWithoutNullStreams;
  readonly closed: Promise<{ exitCode: number | null; signal: string | null }>;
  private counter = 0;
  private pending = new Map<
    string,
    {
      resolve: (value: JsonObject) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private ended = false;
  private failure: Error | undefined;
  private closing: Promise<{ exitCode: number | null; signal: string | null }> | undefined;

  constructor(options: {
    executable: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
    onEvent: (event: JsonObject) => void;
    onFailure: (error: Error) => void;
    onStderr?: (text: string) => void;
  }) {
    this.child = spawn(options.executable, ['--mode', 'rpc', '--no-session', ...options.args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    const fail = (error: Error) => {
      if (this.failure) {
        return;
      }
      this.failure = error;
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      this.pending.clear();
      options.onFailure(error);
    };

    const decoder = new JsonlDecoder((event) => {
      options.onEvent(safeRpcEvent(event));
      if (event.type !== 'response' || typeof event.id !== 'string') {
        return;
      }
      const pending = this.pending.get(event.id);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timer);
      this.pending.delete(event.id);
      if (event.success === true) {
        pending.resolve(object(event.data));
      } else {
        pending.reject(
          new Error(
            `Pi ${String(event.command)} rejected: ${String(event.error ?? 'unknown error')}`,
          ),
        );
      }
    });

    this.child.stdout.on('data', (chunk: Buffer) => {
      try {
        decoder.push(chunk);
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });

    this.child.stderr.on('data', (chunk: Buffer) => options.onStderr?.(chunk.toString('utf8')));
    this.child.on('error', fail);
    this.child.stdin.on('error', fail);

    this.closed = new Promise((resolve) =>
      this.child.once('close', (exitCode, signal) => {
        this.ended = true;
        try {
          decoder.finish();
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
        }
        if (this.pending.size) {
          fail(new Error(`Pi exited before RPC response (exit ${exitCode}, signal ${signal})`));
        }
        resolve({ exitCode, signal });
      }),
    );
  }

  request(type: string, data: JsonObject = {}, timeoutMs = 10_000): Promise<JsonObject> {
    if (this.failure || this.ended) {
      return Promise.reject(this.failure ?? new Error('Pi process already exited'));
    }
    const id = `eval-rpc-${++this.counter}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Pi RPC ${type} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ ...data, id, type })}\n`);
    });
  }

  async close(): Promise<{ exitCode: number | null; signal: string | null }> {
    if (this.closing) {
      return this.closing;
    }
    this.closing = this.closeProcess();
    return this.closing;
  }

  private async closeProcess(): Promise<{ exitCode: number | null; signal: string | null }> {
    if (!this.ended) {
      this.child.stdin.end();
    }
    const signal = (name: NodeJS.Signals) => {
      if (this.ended || !this.child.pid) {
        return;
      }
      try {
        if (process.platform !== 'win32') {
          process.kill(-this.child.pid, name);
        } else {
          this.child.kill(name);
        }
      } catch {
        /* Already exited. */
      }
    };
    const terminate = setTimeout(() => signal('SIGTERM'), 500);
    const kill = setTimeout(() => signal('SIGKILL'), 1500);
    try {
      return await this.closed;
    } finally {
      clearTimeout(terminate);
      clearTimeout(kill);
    }
  }
}
