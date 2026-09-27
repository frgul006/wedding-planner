import { pathToFileURL } from 'node:url';
import { register } from 'tsx/esm/api';
import type { Judge, Runner, Suite } from '../core/types.ts';

/** Default-export an ordinary TypeScript object. Factories are called only when needed. */
export interface EvalConfig {
  suite: Suite;
  createRunner?(context: {
    storeDirectory: string;
    recordingsDirectory: string;
  }): Runner | Promise<Runner>;
  createJudge?(): Judge | Promise<Judge>;
  budgetUsd?: number;
}

let unregister: (() => Promise<void>) | undefined;

/** Keep hooks alive for lazy imports in the factories; the one-shot CLI disposes them. */
export async function disposeConfigLoader(): Promise<void> {
  await unregister?.();
  unregister = undefined;
}

export async function loadConfig(filename: string): Promise<EvalConfig> {
  unregister ??= register();
  // Unscoped hooks allow a CommonJS config to import the package's ESM exports.
  const module: { default?: unknown } = await import(pathToFileURL(filename).href);
  // tsx follows the consumer's module mode. CJS-transpiled default exports carry
  // the standard __esModule wrapper inside Node's module.default namespace.
  const exported = module.default;
  const config =
    exported && typeof exported === 'object' && '__esModule' in exported && exported.__esModule
      ? (exported as { default?: unknown }).default
      : exported;
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Config must default-export an EvalConfig object');
  }
  const candidate = config as Partial<EvalConfig>;
  const suite = candidate.suite;
  if (
    !suite ||
    typeof suite.id !== 'string' ||
    !suite.id.trim() ||
    !Array.isArray(suite.tasks) ||
    !Array.isArray(suite.graders)
  ) {
    throw new Error('Config suite must have an id, tasks array, and graders array');
  }
  if (suite.graders.some((grader) => !grader || !['code', 'model'].includes(grader.kind))) {
    throw new Error('Config graders must declare kind code or model');
  }
  for (const name of ['createRunner', 'createJudge'] as const) {
    if (candidate[name] !== undefined && typeof candidate[name] !== 'function') {
      throw new Error(`Config ${name} must be a factory function`);
    }
  }
  if (
    candidate.budgetUsd !== undefined &&
    (typeof candidate.budgetUsd !== 'number' ||
      !Number.isFinite(candidate.budgetUsd) ||
      candidate.budgetUsd < 0)
  ) {
    throw new Error('Config budgetUsd must be a finite nonnegative number');
  }
  return candidate as EvalConfig;
}
