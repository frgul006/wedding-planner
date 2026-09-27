import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { access, readFile, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { object, type JsonObject } from './pi-rpc-process.ts';
import { piConversationSettings } from './pi-configuration.ts';

/** Fail before probing when global-only projection would misrepresent a trusted project. */
export async function assertSupportedProjectRuntimeSettings(
  cwd: string,
  projectTrusted: boolean,
): Promise<void> {
  if (!projectTrusted) {
    return;
  }
  let raw: string;
  try {
    raw = await readFile(join(cwd, '.pi/settings.json'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw new Error('Cannot inspect the trusted source project’s .pi/settings.json.');
  }
  let settings: JsonObject;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error();
    }
    settings = parsed as JsonObject;
  } catch {
    throw new Error(
      'The trusted source project’s .pi/settings.json is not a valid settings object.',
    );
  }
  const overrides = [
    'defaultProvider',
    'defaultModel',
    'defaultThinkingLevel',
    'defaultTools',
    ...Object.keys(piConversationSettings(settings)),
  ].filter((key) => Object.hasOwn(settings, key));
  if (overrides.length) {
    throw new Error(
      `Trusted project runtime overrides are not supported by this isolated Pi adapter: ${overrides.join(', ')}. Select --agent-source with supported settings or add effective project-settings projection before evaluating this configuration.`,
    );
  }
}

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

export async function exists(path: string): Promise<boolean> {
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

export async function readJson(path: string): Promise<JsonObject> {
  return exists(path).then(async (found) =>
    found ? object(JSON.parse(await readFile(path, 'utf8'))) : {},
  );
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
        if (next !== undefined) {
          settingsText[scope] = next;
        }
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
    if (await exists(selected)) {
      systemPrompts.push({
        ...(await source(selected, {
          injectedAtStartup: true,
        })),
        scope: selected === local ? 'project' : 'user',
      });
    }
  }
  const instructionByHash = new Map<string, string[]>();
  for (const item of instructions) {
    instructionByHash.set(item.sha256, [...(instructionByHash.get(item.sha256) ?? []), item.path]);
  }
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
