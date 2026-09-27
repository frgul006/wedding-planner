type CancellationSignal = 'SIGINT' | 'SIGTERM';

/** Keep the CLI alive until its normal cleanup and evidence writes finish. */
export function installCancellationHandlers(onCancel?: (signal: CancellationSignal) => void): {
  signal: AbortSignal;
  readonly exitCode: 130 | 143 | undefined;
  dispose(): void;
} {
  const controller = new AbortController();
  let exitCode: 130 | 143 | undefined;
  const cancel = (signal: CancellationSignal) => {
    // Repeated signals must not interrupt credential removal or evidence sealing.
    if (controller.signal.aborted) return;
    exitCode = signal === 'SIGINT' ? 130 : 143;
    controller.abort(new Error(`Evaluation cancelled by ${signal}`));
    onCancel?.(signal);
  };
  const interrupt = () => cancel('SIGINT');
  const terminate = () => cancel('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  return {
    signal: controller.signal,
    get exitCode() {
      return exitCode;
    },
    dispose() {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
    },
  };
}
