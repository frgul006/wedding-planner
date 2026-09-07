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
  resources: Awaited<ReturnType<typeof inspectPiResources>>;
}

/** Keep model settings and selected native authentication, suppress optional code. */
export async function preparePiConfiguration(
  pi: InspectedPi,
  paths: TrialPaths,
  runtimeMs: number,
): Promise<PrivateAuthentication> {
  const original = JSON.parse(await readFile(join(pi.agentDir, 'settings.json'), 'utf8')) as Record<
    string,
    unknown
  >;
  const provider = pi.defaults?.provider ?? original.defaultProvider;
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
  const modelKeys = [
    'defaultProvider',
    'defaultModel',
    'defaultThinkingLevel',
    'modelThinkingLevels',
    'thinkingBudgets',
  ];
  const settings = {
    ...Object.fromEntries(
      modelKeys.filter((key) => key in original).map((key) => [key, original[key]]),
    ),
    packages: [],
    extensions: [],
    defaultProjectTrust: 'always',
    enableInstallTelemetry: false,
    enableAnalytics: false,
    compaction: { enabled: false },
    retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0 } },
  };
  await writeFile(join(paths.piDirectory, 'settings.json'), JSON.stringify(settings, null, 2));
  return authentication;
}
