import type {
  AgentResult,
  AgentRunner,
  AgentRunRequest,
  EvidenceEvent,
  TrialStatus,
} from './types.js';
import { normalizePiEvent } from './pi-evidence.ts';
import { endpointHash } from './pi-endpoint-selection.ts';
import { modelMetadata, RpcProcess, object, type JsonObject } from './pi-rpc-process.ts';
import { UsageAccumulator } from './pi-usage.ts';
import {
  CACHED_TOKEN_WEIGHT,
  resolveTrialLimits,
  weightedTokens,
} from '../../core/trial-limits.ts';

export class PiRpcRunner implements AgentRunner {
  constructor(
    private readonly options: {
      requiredExtensionCommand?: string;
      expectedEndpointHash?: string;
    } = {},
  ) {}

  async run(request: AgentRunRequest): Promise<AgentResult> {
    if (request.env.OPENAI_API_KEY) {
      throw new Error('Grader OPENAI_API_KEY must not enter the Pi process environment');
    }
    const limits = resolveTrialLimits(request.limits);
    if (
      request.maxEstimatedCostUsd !== null &&
      (!Number.isFinite(request.maxEstimatedCostUsd) || request.maxEstimatedCostUsd <= 0)
    ) {
      throw new Error('maxEstimatedCostUsd must be finite and greater than zero');
    }

    const startedAt = new Date().toISOString();
    const startedClock = performance.now();
    let eventSequence = 0;
    const usage = new UsageAccumulator();
    let model: JsonObject | null = null;
    let thinkingLevel: string | null = null;
    let status: TrialStatus = 'completed';
    let error: string | undefined;
    let settled = false;
    let stopping = false;
    let hasAgentError = false;
    let callbackFailed = false;
    let turns = 0;
    let turnsStarted = 0;
    let limitHit: AgentResult['limitHit'];
    let executionRuntimeMs: number | undefined;
    const finishRuntime = () => {
      executionRuntimeMs ??= performance.now() - startedClock;
    };
    const limitUsage = (): NonNullable<AgentResult['limitUsage']> => ({
      // Session accounting and process shutdown happen after the execution bound.
      runtimeMs: executionRuntimeMs ?? performance.now() - startedClock,
      turns,
      turnsStarted,
      weightedTokens: weightedTokens(usage.value()),
      cachedTokenWeight: CACHED_TOKEN_WEIGHT,
    });

    let rpc: RpcProcess;
    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });

    const emit = (actor: EvidenceEvent['actor'], kind: EvidenceEvent['kind'], data: JsonObject) => {
      const sequence = ++eventSequence;
      const event = normalizePiEvent({
        id: `agent-e${sequence}`,
        sequence,
        timestamp: new Date().toISOString(),
        actor,
        kind,
        data,
      });
      // The recorder retains observations before attempting disk writes. Keep
      // delivering shutdown evidence after a writer failure, but stop only once.
      try {
        request.onEvent(event);
      } catch (failure) {
        if (!callbackFailed) {
          callbackFailed = true;
          stop(
            'infrastructure_error',
            `Evidence writer failed: ${failure instanceof Error ? failure.message : String(failure)}`,
          );
        }
      }
    };

    const stop = (next: TrialStatus, message: string, hit?: AgentResult['limitHit']) => {
      // Final session totals can expose paid usage only after agent_settled.
      // Record that observed token/cost breach, but never replace an earlier stop.
      if (
        stopping ||
        (settled && hit?.kind !== 'maxTokens' && hit?.kind !== 'maxEstimatedCostUsd')
      ) {
        return;
      }
      finishRuntime();
      stopping = true;
      status = next;
      error = message;
      limitHit = hit;
      emit('evaluator', 'lifecycle', {
        type: 'stop_requested',
        reason: next,
        message,
        limits,
        limitUsage: limitUsage(),
        ...(hit ? { limitHit: hit } : {}),
      });
      resolveDone();
      // Interrupt startup requests as well as generation. A provider may never emit usage.
      if (!settled) {
        void rpc
          ?.request('abort', {}, 500)
          .catch(() => undefined)
          .then(() => rpc.close());
      }
    };

    if (request.signal?.aborted) {
      finishRuntime();
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
        limits,
        limitUsage: limitUsage(),
        model,
        thinkingLevel,
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
        if (event.type === 'turn_start') {
          turnsStarted++;
        }
        if (event.type === 'turn_end') {
          turns++;
        }
        // Timers can be delayed by synchronous event/evidence processing. Never
        // accept a late settlement merely because the timer callback ran later.
        const elapsed = limitUsage().runtimeMs;
        if (!settled && elapsed >= limits.runtimeMs) {
          stop('timeout', `Agent runtime exceeded ${limits.runtimeMs}ms`, {
            kind: 'runtimeMs',
            threshold: limits.runtimeMs,
            observed: elapsed,
          });
        }
        if (event.type === 'message_end') {
          const message = object(event.message);
          if (
            message.role === 'assistant' &&
            ['stop', 'toolUse'].includes(String(message.stopReason))
          ) {
            hasAgentError = false;
            if (!stopping) {
              error = undefined;
            }
          }
          if (
            message.role === 'assistant' &&
            ['error', 'aborted', 'length'].includes(String(message.stopReason))
          ) {
            hasAgentError = true;
            if (!stopping) {
              error = String(
                message.errorMessage ?? `Assistant stopped with ${message.stopReason}`,
              );
            }
          }
        }
        if (event.type === 'extension_ui_request') {
          stop('infrastructure_error', 'Trial requested interactive extension UI');
        }
        const measured = usage.value();
        const tokens = weightedTokens(measured);
        if (tokens >= limits.maxTokens) {
          stop(
            'budget_exceeded',
            `Observed weighted token budget reached (${tokens} >= ${limits.maxTokens}; cached tokens × ${CACHED_TOKEN_WEIGHT})`,
            { kind: 'maxTokens', threshold: limits.maxTokens, observed: tokens },
          );
        }
        if (turns >= limits.maxTurns) {
          stop('budget_exceeded', `Completed turn limit reached (${turns} >= ${limits.maxTurns})`, {
            kind: 'maxTurns',
            threshold: limits.maxTurns,
            observed: turns,
          });
        }
        if (
          request.maxEstimatedCostUsd !== null &&
          measured.estimatedCostUsd !== null &&
          measured.estimatedCostUsd >= request.maxEstimatedCostUsd
        ) {
          stop('budget_exceeded', 'Observed estimated agent cost budget reached', {
            kind: 'maxEstimatedCostUsd',
            threshold: request.maxEstimatedCostUsd,
            observed: measured.estimatedCostUsd,
          });
        }
        if (event.type === 'agent_settled') {
          finishRuntime();
          settled = true;
          resolveDone();
        }
      },
    });

    void rpc.closed.then(({ exitCode, signal }) => {
      if (!settled && !stopping) {
        stop(
          'infrastructure_error',
          `Pi exited before agent_settled (exit ${exitCode}, signal ${signal})`,
        );
      }
    });

    const timeout = setTimeout(
      () =>
        stop('timeout', `Agent runtime exceeded ${limits.runtimeMs}ms`, {
          kind: 'runtimeMs',
          threshold: limits.runtimeMs,
          observed: limitUsage().runtimeMs,
        }),
      limits.runtimeMs,
    );
    const cancel = () => stop('cancelled', 'Evaluation cancelled by user.');
    request.signal?.addEventListener('abort', cancel, { once: true });

    try {
      emit('evaluator', 'lifecycle', {
        type: 'pi_started',
        executable: request.executable ?? 'pi',
        args: ['--mode', 'rpc', '--no-session', ...(request.args ?? [])],
        limits,
        cachedTokenWeight: CACHED_TOKEN_WEIGHT,
        turnDefinition:
          'One completed assistant response and its resulting tool calls/results; counts native turn_end, including retries. Hitting the limit stops even at an otherwise natural completion boundary.',
        maxEstimatedCostUsd: request.maxEstimatedCostUsd,
        agentCostLimitEnabled: request.maxEstimatedCostUsd !== null,
        agentCostEstimateIsBilling: false,
        budgetEnforcement:
          request.maxEstimatedCostUsd === null
            ? 'Subscription agent: dollar threshold disabled; catalog cost remains informational. Runtime, completed-turn and weighted-token limits apply independently. Cached tokens count at 0.1; observed limits can overshoot in flight.'
            : 'Independent runtime, completed-turn, weighted-token and estimated-cost limits; observed usage may overshoot in flight.',
      });
      const state = await rpc.request('get_state', {}, Math.min(limits.runtimeMs, 15_000));
      model = modelMetadata(state.model);
      thinkingLevel = typeof state.thinkingLevel === 'string' ? state.thinkingLevel : null;
      if (!model) {
        throw new Error('Pi has no active model');
      }
      if (
        this.options.expectedEndpointHash &&
        (typeof object(state.model).baseUrl !== 'string' ||
          endpointHash(object(state.model).baseUrl as string) !== this.options.expectedEndpointHash)
      ) {
        throw new Error(
          'Active Pi endpoint does not match the explicit evaluation endpoint policy; no prompt was sent.',
        );
      }
      if (
        request.expectedModel &&
        (model.provider !== request.expectedModel.provider ||
          model.id !== request.expectedModel.id ||
          thinkingLevel !== request.expectedModel.thinkingLevel)
      ) {
        throw new Error(
          'Active Pi model/reasoning does not match the frozen experiment configuration',
        );
      }
      const commands = await rpc.request('get_commands');
      const requiredCommand = this.options.requiredExtensionCommand;
      if (
        requiredCommand &&
        (!Array.isArray(commands.commands) ||
          !commands.commands.some(
            (command) =>
              object(command).source === 'extension' && object(command).name === requiredCommand,
          ))
      ) {
        throw new Error(
          `Required isolation extension did not register ${requiredCommand}; refusing to prompt Pi`,
        );
      }
      // Conversation behavior belongs to the selected native settings/profile.
      // The runner only enforces the outer trial deadline and usage bounds.
      if (!stopping) {
        await rpc.request('prompt', { message: request.prompt });
        await done;
      }
      if (settled && !stopping && hasAgentError) {
        status = 'agent_error';
      }
      if (settled) {
        await rpc.request('get_session_stats', {}, 1500).catch(() => undefined);
      }
    } catch (failure) {
      if (!stopping) {
        finishRuntime();
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
      limits,
      limitUsage: limitUsage(),
      ...(limitHit ? { limitHit } : {}),
      model,
      thinkingLevel,
      ...(error ? { error } : {}),
    };
  }
}
