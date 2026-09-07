import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import type {
  AgentResult,
  AgentRunner,
  AgentRunRequest,
  EvidenceEvent,
  TrialStatus,
  Usage,
} from '../domain/types.js';
import { normalizePiEvent } from './pi-evidence.ts';

type JsonObject = Record<string, unknown>;
export const object = (value: unknown): JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {};
const number = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

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
      if (Buffer.byteLength(line) > this.maxRecordBytes)
        throw new Error('Pi RPC record exceeds evidence size limit');
      if (!line) continue;
      const parsed: unknown = JSON.parse(line);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error('Pi RPC record must be an object');
      this.receive(parsed as JsonObject);
    }
    if (Buffer.byteLength(this.pending) > this.maxRecordBytes)
      throw new Error('Pi RPC incomplete record exceeds evidence size limit');
  }
  finish(): void {
    this.pending += this.decoder.end();
    if (this.pending.trim()) throw new Error('Pi RPC ended with an incomplete JSONL record');
  }
}

/** Catalog objects may include custom-provider headers. Persist only model metadata. */
export function modelMetadata(value: unknown): JsonObject | null {
  const model = object(value);
  if (typeof model.id !== 'string' || typeof model.provider !== 'string') return null;
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
  if (event.type !== 'response') return event;
  const data = object(event.data);
  if (event.command === 'get_state')
    return { ...event, data: { ...data, model: modelMetadata(data.model) } };
  if (event.command === 'get_available_models')
    return {
      ...event,
      data: { models: Array.isArray(data.models) ? data.models.map(modelMetadata) : [] },
    };
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
      if (this.failure) return;
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
      if (event.type !== 'response' || typeof event.id !== 'string') return;
      const pending = this.pending.get(event.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(event.id);
      if (event.success === true) pending.resolve(object(event.data));
      else
        pending.reject(
          new Error(
            `Pi ${String(event.command)} rejected: ${String(event.error ?? 'unknown error')}`,
          ),
        );
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
        if (this.pending.size)
          fail(new Error(`Pi exited before RPC response (exit ${exitCode}, signal ${signal})`));
        resolve({ exitCode, signal });
      }),
    );
  }
  request(type: string, data: JsonObject = {}, timeoutMs = 10_000): Promise<JsonObject> {
    if (this.failure || this.ended)
      return Promise.reject(this.failure ?? new Error('Pi process already exited'));
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
    if (this.closing) return this.closing;
    this.closing = this.closeProcess();
    return this.closing;
  }
  private async closeProcess(): Promise<{ exitCode: number | null; signal: string | null }> {
    if (!this.ended) this.child.stdin.end();
    const signal = (name: NodeJS.Signals) => {
      if (this.ended || !this.child.pid) return;
      try {
        if (process.platform !== 'win32') process.kill(-this.child.pid, name);
        else this.child.kill(name);
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

export class UsageAccumulator {
  private finished = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  private streaming: JsonObject = {};
  private known = false;
  accept(event: JsonObject): void {
    if (event.type === 'message_start') this.streaming = {};
    if (event.type === 'message_update') this.streaming = object(event.usage);
    if (event.type === 'message_end') {
      const message = object(event.message);
      if (message.role === 'assistant' || message.role === 'toolResult') {
        const usage = object(message.usage);
        if (Object.keys(usage).length) {
          for (const field of ['input', 'output', 'cacheRead', 'cacheWrite'] as const)
            this.finished[field] += number(usage[field]);
          this.finished.cost += number(object(usage.cost).total);
          this.known ||= typeof object(usage.cost).total === 'number';
        }
      }
      this.streaming = {};
    }
  }
  value(): Usage {
    const streamingCost = object(this.streaming.cost).total;
    return {
      inputTokens: this.finished.input + number(this.streaming.input),
      outputTokens: this.finished.output + number(this.streaming.output),
      cacheReadTokens: this.finished.cacheRead + number(this.streaming.cacheRead),
      cacheWriteTokens: this.finished.cacheWrite + number(this.streaming.cacheWrite),
      estimatedCostUsd:
        this.known || typeof streamingCost === 'number'
          ? this.finished.cost + number(streamingCost)
          : null,
      costSource:
        'Pi provider-reported usage × Pi catalog prices; estimate, not billing or a provider-enforced cap',
    };
  }
}

export class PiRpcRunner implements AgentRunner {
  constructor(private readonly options: { requiredExtensionCommand?: string } = {}) {}

  async run(request: AgentRunRequest): Promise<AgentResult> {
    if (request.env.OPENAI_API_KEY)
      throw new Error('Grader OPENAI_API_KEY must not enter the Pi process environment');
    for (const [name, value] of Object.entries({
      runtimeMs: request.runtimeMs,
      maxTokens: request.maxTokens,
      ...(request.maxEstimatedCostUsd === null
        ? {}
        : { maxEstimatedCostUsd: request.maxEstimatedCostUsd }),
    })) {
      if (!Number.isFinite(value) || value <= 0)
        throw new Error(`${name} must be finite and greater than zero`);
    }
    const startedAt = new Date().toISOString();
    const events: EvidenceEvent[] = [];
    const usage = new UsageAccumulator();
    let model: JsonObject | null = null;
    let thinkingLevel: string | null = null;
    let status: TrialStatus = 'completed';
    let error: string | undefined;
    let settled = false;
    let stopping = false;
    let hasAgentError = false;
    let callbackFailed = false;
    let rpc: RpcProcess;
    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const emit = (actor: EvidenceEvent['actor'], kind: EvidenceEvent['kind'], data: JsonObject) => {
      const event = normalizePiEvent({
        id: `agent-e${events.length + 1}`,
        sequence: events.length + 1,
        timestamp: new Date().toISOString(),
        actor,
        kind,
        data,
      });
      events.push(event);
      if (!callbackFailed) {
        try {
          request.onEvent?.(event);
        } catch (failure) {
          callbackFailed = true;
          stop(
            'infrastructure_error',
            `Evidence writer failed: ${failure instanceof Error ? failure.message : String(failure)}`,
          );
        }
      }
    };
    const stop = (next: TrialStatus, message: string) => {
      if (stopping || settled) return;
      stopping = true;
      status = next;
      error = message;
      emit('evaluator', 'lifecycle', { type: 'stop_requested', reason: next, message });
      resolveDone();
      // Interrupt startup requests as well as generation. A provider may never emit usage.
      void rpc
        ?.request('abort', {}, 500)
        .catch(() => undefined)
        .then(() => rpc.close());
    };
    if (request.signal?.aborted) {
      emit('evaluator', 'lifecycle', {
        type: 'stop_requested',
        reason: 'cancelled',
        message: 'Evaluation cancelled before Pi started.',
      });
      return {
        status: 'cancelled',
        startedAt,
        endedAt: new Date().toISOString(),
        exitCode: null,
        signal: null,
        usage: usage.value(),
        model,
        thinkingLevel,
        events,
        error: 'Evaluation cancelled before Pi started.',
      };
    }
    rpc = new RpcProcess({
      executable: request.executable ?? 'pi',
      args: request.args ?? [],
      cwd: request.cwd,
      env: request.env,
      onFailure: (failure) => stop('infrastructure_error', failure.message),
      onStderr: (text) => emit('evaluator', 'lifecycle', { type: 'pi_stderr', text }),
      onEvent: (event) => {
        emit(event.type === 'response' ? 'evaluator' : 'agent', 'pi', event);
        usage.accept(event);
        if (event.type === 'message_end') {
          const message = object(event.message);
          if (
            message.role === 'assistant' &&
            ['error', 'aborted', 'length'].includes(String(message.stopReason))
          ) {
            hasAgentError = true;
            if (!stopping)
              error = String(
                message.errorMessage ?? `Assistant stopped with ${message.stopReason}`,
              );
          }
        }
        if (event.type === 'extension_ui_request')
          stop('infrastructure_error', 'Trial requested interactive extension UI');
        const measured = usage.value();
        const tokens =
          measured.inputTokens +
          measured.outputTokens +
          measured.cacheReadTokens +
          measured.cacheWriteTokens;
        if (tokens >= request.maxTokens)
          stop(
            'budget_exceeded',
            `Observed token budget reached (${tokens} >= ${request.maxTokens})`,
          );
        if (
          request.maxEstimatedCostUsd !== null &&
          measured.estimatedCostUsd !== null &&
          measured.estimatedCostUsd >= request.maxEstimatedCostUsd
        )
          stop('budget_exceeded', 'Observed estimated agent cost budget reached');
        if (event.type === 'agent_settled') {
          settled = true;
          resolveDone();
        }
      },
    });
    void rpc.closed.then(({ exitCode, signal }) => {
      if (!settled && !stopping)
        stop(
          'infrastructure_error',
          `Pi exited before agent_settled (exit ${exitCode}, signal ${signal})`,
        );
    });
    const timeout = setTimeout(
      () => stop('timeout', `Agent runtime exceeded ${request.runtimeMs}ms`),
      request.runtimeMs,
    );
    const cancel = () => stop('cancelled', 'Evaluation cancelled by user.');
    request.signal?.addEventListener('abort', cancel, { once: true });
    try {
      emit('evaluator', 'lifecycle', {
        type: 'pi_started',
        executable: request.executable ?? 'pi',
        args: ['--mode', 'rpc', '--no-session', ...(request.args ?? [])],
        runtimeMs: request.runtimeMs,
        maxTokens: request.maxTokens,
        maxEstimatedCostUsd: request.maxEstimatedCostUsd,
        agentCostLimitEnabled: request.maxEstimatedCostUsd !== null,
        agentCostEstimateIsBilling: false,
        budgetEnforcement:
          request.maxEstimatedCostUsd === null
            ? 'Subscription agent: dollar threshold disabled; catalog cost remains informational. Observed token abort and bounded runtime remain enabled; a streaming request may overshoot the token limit.'
            : 'Observed token and estimated-cost abort; a streaming request may overshoot; runtime termination is bounded',
      });
      const state = await rpc.request('get_state', {}, Math.min(request.runtimeMs, 15_000));
      model = modelMetadata(state.model);
      thinkingLevel = typeof state.thinkingLevel === 'string' ? state.thinkingLevel : null;
      if (!model) throw new Error('Pi has no active model');
      if (
        request.expectedModel &&
        (model.provider !== request.expectedModel.provider ||
          model.id !== request.expectedModel.id ||
          thinkingLevel !== request.expectedModel.thinkingLevel)
      )
        throw new Error(
          'Active Pi model/reasoning does not match the frozen experiment configuration',
        );
      const commands = await rpc.request('get_commands');
      const requiredCommand = this.options.requiredExtensionCommand;
      if (
        requiredCommand &&
        (!Array.isArray(commands.commands) ||
          !commands.commands.some(
            (command) =>
              object(command).source === 'extension' && object(command).name === requiredCommand,
          ))
      )
        throw new Error(
          `Required isolation extension did not register ${requiredCommand}; refusing to prompt Pi`,
        );
      await rpc.request('set_auto_retry', { enabled: false });
      await rpc.request('set_auto_compaction', { enabled: false });
      if (!stopping) {
        await rpc.request('prompt', { message: request.prompt });
        await done;
      }
      if (settled && !stopping && hasAgentError) status = 'agent_error';
      if (settled) await rpc.request('get_session_stats', {}, 1500).catch(() => undefined);
    } catch (failure) {
      if (!stopping) {
        stopping = true;
        status = 'infrastructure_error';
        error = failure instanceof Error ? failure.message : String(failure);
        emit('evaluator', 'lifecycle', { type: 'infrastructure_error', message: error });
      }
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener('abort', cancel);
    }
    const exit = await rpc.close();
    return {
      status,
      startedAt,
      endedAt: new Date().toISOString(),
      ...exit,
      usage: usage.value(),
      model,
      thinkingLevel,
      events,
      ...(error ? { error } : {}),
    };
  }
}
