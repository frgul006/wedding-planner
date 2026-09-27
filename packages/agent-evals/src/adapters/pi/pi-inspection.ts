import { access, chmod, copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, join, delimiter } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { modelMetadata, object, RpcProcess } from './pi-rpc-process.js';
import { piConversationSettings } from './pi-configuration.ts';
import {
  assertSupportedProjectRuntimeSettings,
  exists,
  inspectPiResources,
  readJson,
} from './pi-resource-inspection.ts';

/** Auth type is billing provenance. Never return token fields or parse-error details. */
export async function inspectPiAuthentication(
  agentDir: string,
  provider: string | null,
): Promise<{ provider: string | null; type: 'oauth' | 'api_key' | 'unknown' }> {
  if (!provider) {
    return { provider, type: 'unknown' };
  }
  try {
    const auth = await readJson(join(agentDir, 'auth.json'));
    const type = object(auth[provider]).type;
    return { provider, type: type === 'oauth' || type === 'api_key' ? type : 'unknown' };
  } catch {
    return { provider, type: 'unknown' };
  }
}

export async function locatePi(
  executable = 'pi',
  env: Record<string, string | undefined> = process.env,
): Promise<{ executable: string; packageRoot: string; version: string }> {
  const candidates =
    isAbsolute(executable) || executable.includes('/')
      ? [executable]
      : (env.PATH ?? '').split(delimiter).map((dir) => join(dir, executable));
  for (const candidate of candidates) {
    if (
      !(await access(candidate, constants.X_OK).then(
        () => true,
        () => false,
      ))
    ) {
      continue;
    }
    const resolved = await realpath(candidate);
    let dir = dirname(resolved);
    while (dirname(dir) !== dir) {
      const manifest = await readJson(join(dir, 'package.json'));
      if (
        manifest.name === '@earendil-works/pi-coding-agent' ||
        manifest.name === '@mariozechner/pi-coding-agent'
      ) {
        return { executable: candidate, packageRoot: dir, version: String(manifest.version) };
      }
      dir = dirname(dir);
    }
  }
  throw new Error(`Could not locate an installed native Pi package for ${executable}`);
}

/** Read-only RPC startup, get_state/get_available_models, no prompts or model overrides. */
export async function inspectPi(options: {
  cwd: string;
  piExecutable?: string;
  agentDir?: string;
  env?: Record<string, string>;
}) {
  const env = { ...process.env, ...options.env };
  delete env.OPENAI_API_KEY;
  const installation = await locatePi(options.piExecutable, env);
  const agentDir =
    options.agentDir ?? env.PI_CODING_AGENT_DIR ?? join(env.HOME ?? homedir(), '.pi/agent');
  const settings = await readJson(join(agentDir, 'settings.json'));
  const resources = await inspectPiResources({
    cwd: options.cwd,
    packageRoot: installation.packageRoot,
    agentDir,
  });
  await assertSupportedProjectRuntimeSettings(options.cwd, resources.projectTrusted);
  const temporary = await mkdtemp(join(tmpdir(), 'pi-eval-inspect-'));
  let rpc: RpcProcess | undefined;
  try {
    await chmod(temporary, 0o700);
    const probeDir = join(temporary, 'agent');
    await mkdir(probeDir, { mode: 0o700 });
    // Authentication is copied verbatim to a private, short-lived directory. Only its safe type is reported separately.
    for (const name of ['auth.json', 'models.json', 'models-store.json']) {
      const file = join(agentDir, name);
      if (await exists(file)) {
        await copyFile(file, join(probeDir, name));
        await chmod(join(probeDir, name), 0o600);
      }
    }
    await writeFile(
      join(probeDir, 'settings.json'),
      JSON.stringify({
        defaultProvider: settings.defaultProvider,
        defaultModel: settings.defaultModel,
        defaultThinkingLevel: settings.defaultThinkingLevel,
        modelThinkingLevels: settings.modelThinkingLevels,
        packages: [],
        retry: { enabled: false, provider: { maxRetries: 0 } },
        compaction: { enabled: false },
        defaultProjectTrust: 'never',
      }),
      { mode: 0o600 },
    );
    let failure: Error | undefined;
    rpc = new RpcProcess({
      executable: installation.executable,
      args: ['--no-extensions', '--no-skills', '--no-prompt-templates', '--no-context-files'],
      cwd: temporary,
      env: Object.fromEntries(
        Object.entries({ ...env, PI_CODING_AGENT_DIR: probeDir }).filter(
          (pair): pair is [string, string] => typeof pair[1] === 'string',
        ),
      ),
      onEvent: () => undefined,
      onFailure: (error) => {
        failure = error;
      },
    });
    const state = await rpc.request('get_state', {}, 15_000);
    const available = await rpc.request('get_available_models', {}, 15_000);
    if (failure) {
      throw failure;
    }
    const model = modelMetadata(state.model);
    const authentication = await inspectPiAuthentication(
      agentDir,
      typeof model?.provider === 'string' ? model.provider : null,
    );
    return {
      ...installation,
      agentDir,
      authentication,
      defaults: {
        provider: settings.defaultProvider,
        model: settings.defaultModel,
        thinkingLevel: settings.defaultThinkingLevel,
      },
      conversationSettings: piConversationSettings(settings),
      rpc: {
        model,
        thinkingLevel: state.thinkingLevel ?? null,
        availableModels: Array.isArray(available.models) ? available.models.map(modelMetadata) : [],
        inspectionProfile:
          'Read-only isolated probe; all auto-discovered extensions, skills, prompts and context files disabled. Provider/model/reasoning copied unchanged; normal resource inventory resolved separately without executing extensions.',
      },
      resources,
    };
  } finally {
    await rpc?.close();
    await rm(temporary, { recursive: true, force: true });
  }
}
