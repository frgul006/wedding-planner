import { z } from 'zod';
import type { inspectPi } from './pi-inspection.ts';

type NativeInspection = Awaited<ReturnType<typeof inspectPi>>;
type PiInspection = Pick<NativeInspection, 'defaults'> & {
  rpc: Pick<NativeInspection['rpc'], 'availableModels'>;
};
export interface PiModelSelection {
  provider: string;
  model: string;
  thinkingLevel: string;
}

/** A model override retains the native provider, reasoning and authentication. */
export function selectPiModel(pi: PiInspection, options: { model?: string }): PiModelSelection {
  const saved = z
    .object({ provider: z.string(), model: z.string(), thinkingLevel: z.string() })
    .parse(pi.defaults);
  if (options.model === undefined) return saved;
  const model = z.string().trim().min(1).parse(options.model);
  const available = pi.rpc.availableModels.some(
    (entry) => entry?.provider === saved.provider && entry.id === model,
  );
  if (!available)
    throw new Error(
      `Evaluation model ${saved.provider}/${model} is unavailable in native Pi. Update the native model catalog or select an available model. No fallback model was selected.`,
    );
  return { ...saved, model };
}

/** Explicit reasoning prevents another model's saved preference from changing the experiment. */
export function piModelArguments(selection: PiModelSelection): string[] {
  return [
    '--provider',
    selection.provider,
    '--model',
    selection.model,
    '--thinking',
    selection.thinkingLevel,
  ];
}
