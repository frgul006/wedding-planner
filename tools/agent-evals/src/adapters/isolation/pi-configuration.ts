import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { exists } from './resources.ts';
import { preparePrivatePiAuthentication, type PrivateAuthentication } from './native-auth.ts';
import type { TrialPaths } from './trial-paths.ts';
import type { inspectPiResources } from '../pi-inspection.ts';

export interface InspectedPi {
  packageRoot: string;
  executable: string;
  agentDir: string;
  defaults?: { provider: unknown; model: unknown; thinkingLevel: unknown };
  conversationSettings?: Record<string, unknown>;
  resources: Awaited<ReturnType<typeof inspectPiResources>>;
}

/** Only public behavior settings: never persist arbitrary settings or provider headers. */
export function piConversationSettings(original: Record<string, unknown>): Record<string, unknown> {
  const keys = [
    'modelThinkingLevels',
    'thinkingBudgets',
    'compaction',
    'retry',
    'steeringMode',
    'followUpMode',
    'transport',
  ];
  return Object.fromEntries(
    keys.filter((key) => key in original).map((key) => [key, original[key]]),
  );
}

/** Preserve native conversation settings; the controlled preset is an explicit ablation. */
export function isolatedPiSettings(
  original: Record<string, unknown>,
  runtime: 'native' | 'controlled' = 'native',
): Record<string, unknown> {
  const nativeKeys = ['defaultProvider', 'defaultModel', 'defaultThinkingLevel'];
  return {
    ...piConversationSettings(original),
    ...Object.fromEntries(
      nativeKeys.filter((key) => key in original).map((key) => [key, original[key]]),
    ),
    packages: [],
    extensions: [],
    defaultProjectTrust: 'always',
    enableInstallTelemetry: false,
    enableAnalytics: false,
    ...(runtime === 'controlled'
      ? {
          compaction: { enabled: false },
          retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0 } },
        }
      : {}),
  };
}

/** Authentication stays private; neither preset exposes it to agent tools. */
export async function preparePiConfiguration(
  pi: InspectedPi,
  paths: TrialPaths,
  runtimeMs: number,
  runtime: 'native' | 'controlled' = 'native',
): Promise<PrivateAuthentication> {
  const original = JSON.parse(await readFile(join(pi.agentDir, 'settings.json'), 'utf8')) as Record<
    string,
    unknown
  >;
  const provider = pi.defaults?.provider ?? original.defaultProvider;
  if (
    pi.conversationSettings &&
    JSON.stringify(piConversationSettings(original)) !== JSON.stringify(pi.conversationSettings)
  )
    throw new Error(
      'Native Pi conversation settings changed after inspection. Start a new experiment to freeze the new configuration.',
    );
  if (typeof provider !== 'string' || !provider)
    throw new Error('Select a provider in native Pi before preparing a trial.');
  const authentication = await preparePrivatePiAuthentication({
    packageRoot: pi.packageRoot,
    agentDirectory: pi.agentDir,
    destination: join(paths.piDirectory, 'auth.json'),
    provider,
    runtimeMs,
  });
  for (const destination of paths.privateFiles) {
    const name = basename(destination);
    if (name === 'auth.json') continue;
    const source = join(pi.agentDir, name);
    if (await exists(source)) await writeFile(destination, await readFile(source), { mode: 0o600 });
  }
  const settings = isolatedPiSettings(original, runtime);
  await writeFile(join(paths.piDirectory, 'settings.json'), JSON.stringify(settings, null, 2));
  return authentication;
}
