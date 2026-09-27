import { z } from 'zod';
import type { EvaluationProfile } from './evaluation-config.ts';
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

/** A profile changes only the trial model; native settings and authentication stay intact. */
export function selectPiModel(
  pi: PiInspection,
  profile: EvaluationProfile['pi'],
): PiModelSelection {
  const saved = z
    .object({ provider: z.string(), model: z.string(), thinkingLevel: z.string() })
    .parse(pi.defaults);
  if (!profile.model) return saved;
  const available = pi.rpc.availableModels.some(
    (model) => model?.provider === saved.provider && model.id === profile.model,
  );
  if (!available)
    throw new Error(
      `Evaluation model ${saved.provider}/${profile.model} is unavailable in native Pi. Update the native model catalog or select an available pi.model in the evaluation profile. No fallback model was selected.`,
    );
  return { ...saved, model: profile.model };
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
