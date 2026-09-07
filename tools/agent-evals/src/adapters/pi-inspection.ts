import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, join, delimiter } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { modelMetadata, object, RpcProcess } from './pi-rpc.js';

type JsonObject = Record<string, unknown>;
export interface PiSource {
  path: string;
  realPath: string;
  sha256: string;
  [key: string]: unknown;
}
export interface PiContextSource extends PiSource {
  scope: 'user' | 'project' | 'ancestor';
}
export interface PiSkillSource extends PiSource {
  name: string;
  scope: 'user' | 'project';
  origin: string;
  source: string;
}
interface ResolvedSource {
  path: string;
  enabled: boolean;
  metadata: JsonObject;
}
async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}
async function source(path: string, extra: JsonObject = {}): Promise<PiSource> {
  return {
    path,
    realPath: await realpath(path),
    sha256: createHash('sha256')
      .update(await readFile(path))
      .digest('hex'),
    ...extra,
  };
}
async function readJson(path: string): Promise<JsonObject> {
  return exists(path).then(async (found) =>
    found ? object(JSON.parse(await readFile(path, 'utf8'))) : {},
  );
}

/** Auth type is billing provenance. Never return token fields or parse-error details. */
export async function inspectPiAuthentication(
  agentDir: string,
  provider: string | null,
): Promise<{ provider: string | null; type: 'oauth' | 'api_key' | 'unknown' }> {
  if (!provider) return { provider, type: 'unknown' };
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
    )
      continue;
    const resolved = await realpath(candidate);
    let dir = dirname(resolved);
    while (dirname(dir) !== dir) {
      const manifest = await readJson(join(dir, 'package.json'));
      if (
        manifest.name === '@earendil-works/pi-coding-agent' ||
        manifest.name === '@mariozechner/pi-coding-agent'
      )
        return { executable: candidate, packageRoot: dir, version: String(manifest.version) };
      dir = dirname(dir);
    }
  }
  throw new Error(`Could not locate an installed native Pi package for ${executable}`);
}

/** Use installed Pi's actual resolvers without executing any extension or mutating real settings. */
export async function inspectPiResources(options: {
  cwd: string;
  packageRoot: string;
  agentDir: string;
}) {
  const module = (name: string) =>
    import(pathToFileURL(join(options.packageRoot, 'dist/core', `${name}.js`)).href);
  const [
    { SettingsManager },
    { DefaultPackageManager },
    { loadSkills },
    { loadProjectContextFiles },
    { ProjectTrustStore, hasTrustRequiringProjectResources },
  ] = await Promise.all([
    module('settings-manager'),
    module('package-manager'),
    module('skills'),
    module('resource-loader'),
    module('trust-manager'),
  ]);
  const global = await readJson(join(options.agentDir, 'settings.json'));
  const project = await readJson(join(options.cwd, '.pi/settings.json'));
  const savedTrust: boolean | null = new ProjectTrustStore(options.agentDir).get(options.cwd);
  const projectTrusted =
    !hasTrustRequiringProjectResources(options.cwd) ||
    (savedTrust ?? global.defaultProjectTrust === 'always');
  // The storage backend is deliberately in memory; migrations and loader changes cannot touch the user's settings.
  const settingsText: Record<string, string> = {
    global: JSON.stringify(global),
    project: JSON.stringify(project),
  };
  const settings = SettingsManager.fromStorage(
    {
      withLock(scope: string, callback: (current: string | undefined) => string | undefined) {
        const next = callback(settingsText[scope]);
        if (next !== undefined) settingsText[scope] = next;
      },
    },
    { projectTrusted },
  );
  const packages = new DefaultPackageManager({
    cwd: options.cwd,
    agentDir: options.agentDir,
    settingsManager: settings,
  });
  const missingPackages: string[] = [];
  const resolved = await packages.resolve(async (name: string) => {
    missingPackages.push(name);
    return 'skip';
  });
  const active = (kind: string): ResolvedSource[] =>
    (resolved[kind] as ResolvedSource[]).filter((item) => item.enabled);
  const loaded = loadSkills({
    cwd: options.cwd,
    agentDir: options.agentDir,
    includeDefaults: false,
    skillPaths: active('skills').map((item) => item.path),
  });
  const cwd = await realpath(options.cwd);
  const agentDirectory = await realpath(options.agentDir);
  const instructions: PiContextSource[] = await Promise.all(
    (loadProjectContextFiles(options) as { path: string; content: string }[]).map(async (item) => ({
      ...(await source(item.path, {
        injectedAtStartup: true,
        pilotRuleOccurrences: (item.content.match(/playwright-cli snapshot/g) ?? []).length,
      })),
      scope:
        (await realpath(dirname(item.path))) === agentDirectory
          ? 'user'
          : (await realpath(dirname(item.path))) === cwd
            ? 'project'
            : 'ancestor',
    })),
  );
  const candidates = await Promise.all(
    active('skills').map((item) => source(item.path, item.metadata)),
  );
  const skills: PiSkillSource[] = await Promise.all(
    (loaded.skills as { name: string; filePath: string; disableModelInvocation?: boolean }[]).map(
      async (item) => {
        const realPath = await realpath(item.filePath);
        const candidate = candidates.find((candidate) => candidate.realPath === realPath);
        if (!candidate || !['user', 'project'].includes(String(candidate.scope))) {
          throw new Error(
            `Native Pi did not expose a resource scope for selected skill ${item.name}.`,
          );
        }
        return {
          ...(await source(item.filePath, {
            name: item.name,
            available: true,
            descriptionInSystemPrompt: !item.disableModelInvocation,
            contentLoaded: 'unknown',
          })),
          name: item.name,
          scope: candidate.scope as 'user' | 'project',
          source: String(candidate.source),
          origin: String(candidate.origin),
        };
      },
    ),
  );
  const skillCandidates = candidates.map((candidate) => ({
    ...candidate,
    selected: skills.some((skill) => skill.realPath === candidate.realPath),
  }));
  const list = (kind: string) =>
    Promise.all(
      active(kind).map((item) =>
        source(item.path, {
          ...item.metadata,
          configuredAndDiscovered: true,
          executionObserved: false,
        }),
      ),
    );
  const systemPrompts: PiContextSource[] = [];
  for (const file of ['SYSTEM.md', 'APPEND_SYSTEM.md']) {
    const local = join(options.cwd, '.pi', file);
    const selected = projectTrusted && (await exists(local)) ? local : join(options.agentDir, file);
    if (await exists(selected))
      systemPrompts.push({
        ...(await source(selected, {
          injectedAtStartup: true,
          pilotRuleOccurrences: (
            (await readFile(selected, 'utf8')).match(/playwright-cli snapshot/g) ?? []
          ).length,
        })),
        scope: selected === local ? 'project' : 'user',
      });
  }
  const instructionByHash = new Map<string, string[]>();
  for (const item of instructions)
    instructionByHash.set(item.sha256, [...(instructionByHash.get(item.sha256) ?? []), item.path]);
  return {
    cwd,
    projectTrusted,
    savedTrust,
    instructions,
    skills,
    skillCandidates,
    extensions: await list('extensions'),
    prompts: await list('prompts'),
    systemPrompts,
    skillDiagnostics: loaded.diagnostics as unknown[],
    missingPackages,
    duplicateInstructionSources: [...instructionByHash.values()].filter(
      (paths) => paths.length > 1,
    ),
    metadataSource: `Installed Pi ${options.packageRoot}/dist/core resource, package, skill and trust resolvers; no extensions executed. Project trust uses saved/noninteractive policy; extension trust overrides are unobserved.`,
  };
}

/** Native discovery reads HOME directly, so verify a prepared profile in its own environment. */
export async function inspectPiResourcesInEnvironment(options: {
  cwd: string;
  packageRoot: string;
  agentDir: string;
  executable: string;
  env: Record<string, string>;
}): Promise<Awaited<ReturnType<typeof inspectPiResources>>> {
  const require = createRequire(import.meta.url);
  const script =
    'const { inspectPiResources } = await import(process.argv[1]); process.stdout.write(JSON.stringify(await inspectPiResources(JSON.parse(process.argv[2]))));';
  try {
    const result = await promisify(execFile)(
      options.executable,
      [
        '--import',
        require.resolve('tsx'),
        '--input-type=module',
        '--eval',
        script,
        '--',
        import.meta.url,
        JSON.stringify({
          cwd: options.cwd,
          packageRoot: options.packageRoot,
          agentDir: options.agentDir,
        }),
      ],
      { cwd: options.cwd, env: options.env, timeout: 15_000, maxBuffer: 4 * 1024 * 1024 },
    );
    return JSON.parse(result.stdout) as Awaited<ReturnType<typeof inspectPiResources>>;
  } catch {
    throw new Error(
      'Native resource discovery failed inside the prepared profile. No agent prompt was sent.',
    );
  }
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
    if (failure) throw failure;
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
