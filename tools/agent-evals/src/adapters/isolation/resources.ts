import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import type { TrialPaths } from './trial-paths.ts';
import {
  inspectPiResourcesInEnvironment,
  type inspectPiResources,
  type PiContextSource,
  type PiSource,
} from '../pi-inspection.ts';

export const VALIDATION_INSTRUCTION =
  'Always validate user-facing app changes with `playwright-cli` against the local development server in addition to lint/build checks. Capture at least one `playwright-cli snapshot` for the changed flow.';
export const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Resource scans omit secrets and child symlinks, even inside approved roots. */
export async function resourceFilesIn(root: string): Promise<string[]> {
  if (!(await exists(root))) return [];
  const paths: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (
      entry.isSymbolicLink() ||
      ['node_modules', '.git'].includes(entry.name) ||
      /^(\.env|auth\.json)/i.test(entry.name)
    )
      continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) paths.push(...(await resourceFilesIn(path)));
    else if (entry.isFile()) paths.push(path);
  }
  return paths.sort();
}

export async function copyResources(source: string, destination: string): Promise<void> {
  if (!(await exists(source))) return;
  // Resolve the selected directory once; never follow arbitrary child symlinks.
  await cp(await realpath(source), destination, {
    recursive: true,
    dereference: false,
    filter: async (path) => {
      const name = basename(path);
      return (
        !/^(\.env|auth\.json)/i.test(name) &&
        !['node_modules', '.git'].includes(name) &&
        !(await lstat(path)).isSymbolicLink()
      );
    },
  });
}

type NativeResources = Awaited<ReturnType<typeof inspectPiResources>>;

export interface ResourceMapping {
  kind: 'instruction' | 'system-prompt' | 'skill';
  scope: 'user' | 'project' | 'ancestor';
  sourcePath: string;
  sourceSha256: string;
  destinationPath: string;
  destinationSha256: string;
  origin?: string;
  name?: string;
}
export interface PreparedResources {
  readableFiles: string[];
  skillsDirectory: string;
  resources: Array<{ path: string; sha256: string; kind: string }>;
  fixtureFiles: Array<{ path: string; sha256: string }>;
  fixtureRevision: string;
  originalInstructionSha256: string;
  effectiveInstructionSha256: string;
  skillTreeFingerprint: string;
  instructionChange: { removed: string; source: string } | null;
  sourceProfile: {
    cwd: string;
    projectTrusted: boolean;
    mappings: ResourceMapping[];
    skillTrees: Array<{
      sourcePath: string;
      name: string;
      scope: 'user' | 'project';
      files: Array<{ path: string; sha256: string; mode: number }>;
    }>;
    excludedSkillCandidates: string[];
    deviations: string[];
  };
}

/** Refuse a stale/different checkout or a pilot rule shadowed by native precedence. */
export function validateResourceSelection(sourceRepo: string, native: NativeResources) {
  if (resolve(native.cwd) !== resolve(sourceRepo)) {
    throw new Error(
      'Pi resources were inspected in a different checkout. Inspect the evaluation source checkout before preparing its fixture.',
    );
  }
  const projectInstruction = native.instructions.find((item) => item.scope === 'project');
  if (
    !projectInstruction ||
    resolve(projectInstruction.path) !== join(resolve(sourceRepo), 'AGENTS.md')
  ) {
    throw new Error(
      `The browser-validation pilot requires the active project AGENTS.md. Native Pi selected ${projectInstruction?.path ?? 'no project context file'} instead; the pilot paragraph is shadowed or unavailable.`,
    );
  }
  return {
    projectInstruction,
    ancestors: native.instructions.filter((item) => item.scope === 'ancestor'),
  };
}

async function verifiedContent(source: PiSource): Promise<Buffer> {
  const content = await readFile(source.realPath);
  if (sha256(content) !== source.sha256) {
    throw new Error(
      `A selected Pi resource changed after inspection: ${source.path}. Inspect again before running the trial.`,
    );
  }
  return content;
}

/** Copy selected native winners only, preserving scope and ancestor order. */
export async function prepareResources(options: {
  sourceRepo: string;
  fixtureDirectory: string;
  paths: Pick<TrialPaths, 'workspace' | 'piDirectory' | 'instructionAncestors'>;
  variant: 'enabled' | 'disabled';
  native: NativeResources;
  repositoryWorkspace?: boolean;
}): Promise<PreparedResources> {
  const { paths, sourceRepo, native } = options;
  const selection = validateResourceSelection(sourceRepo, native);
  if (paths.instructionAncestors.length !== selection.ancestors.length) {
    throw new Error('The prepared workspace does not preserve the inspected instruction ancestry.');
  }
  if (!options.repositoryWorkspace) await copyResources(options.fixtureDirectory, paths.workspace);
  // Fixtures supply task files, not instruction/skill settings that could change
  // the selected profile or shadow the instruction under evaluation.
  for (const name of [
    'AGENTS.override.md',
    'AGENTS.md',
    'AGENTS.MD',
    'CLAUDE.md',
    'CLAUDE.MD',
    '.pi',
    '.agents',
  ]) {
    if (!options.repositoryWorkspace && (await exists(join(paths.workspace, name)))) {
      throw new Error(
        `The fixture contains competing agent resources (${name}). Keep agent resources in the source checkout so native inspection can select them.`,
      );
    }
  }
  const mappings: ResourceMapping[] = [];
  const skillTrees: PreparedResources['sourceProfile']['skillTrees'] = [];
  const readableFiles: string[] = [];
  const copySelected = async (
    source: PiContextSource,
    destination: string,
    kind: ResourceMapping['kind'],
    content?: Buffer | string,
  ) => {
    const original = await verifiedContent(source);
    const effective = content ?? original;
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, effective);
    readableFiles.push(destination);
    mappings.push({
      kind,
      scope: source.scope,
      sourcePath: source.path,
      sourceSha256: source.sha256,
      destinationPath: destination,
      destinationSha256: sha256(effective),
    });
  };

  const original = (await verifiedContent(selection.projectInstruction)).toString('utf8');
  if (original.split(VALIDATION_INSTRUCTION).length !== 2) {
    throw new Error(
      'The evaluated validation instruction must occur exactly once in the active project AGENTS.md.',
    );
  }
  const effective =
    options.variant === 'disabled' ? original.replace(VALIDATION_INSTRUCTION, '') : original;
  for (const instruction of native.instructions) {
    const directory =
      instruction.scope === 'user'
        ? paths.piDirectory
        : instruction.scope === 'project'
          ? paths.workspace
          : paths.instructionAncestors[selection.ancestors.indexOf(instruction)]!;
    await copySelected(
      instruction,
      join(directory, basename(instruction.path)),
      'instruction',
      instruction === selection.projectInstruction ? effective : undefined,
    );
  }
  for (const prompt of native.systemPrompts) {
    const directory = prompt.scope === 'user' ? paths.piDirectory : join(paths.workspace, '.pi');
    await copySelected(prompt, join(directory, basename(prompt.path)), 'system-prompt');
  }

  const skillsDirectory = join(paths.piDirectory, 'skills');
  await mkdir(skillsDirectory, { recursive: true });
  for (const skill of native.skills) {
    if (!/^[a-zA-Z0-9_-]+$/.test(skill.name) || basename(skill.path) !== 'SKILL.md') {
      throw new Error(
        `This controlled profile requires a named SKILL.md resource; native Pi selected ${skill.path}.`,
      );
    }
    await verifiedContent(skill);
    const root =
      skill.scope === 'project' ? join(paths.workspace, '.agents/skills') : skillsDirectory;
    const destination = join(root, skill.name);
    if (await exists(destination))
      throw new Error(`Duplicate selected skill destination: ${skill.name}`);
    await copyResources(dirname(skill.realPath), destination);
    const destinationPath = join(destination, 'SKILL.md');
    const destinationSha256 = sha256(await readFile(destinationPath));
    if (destinationSha256 !== skill.sha256)
      throw new Error(`Selected skill changed while copying: ${skill.path}`);
    // Fingerprint the copied tree, not just SKILL.md: referenced helpers affect
    // behavior too. Relative paths keep the digest stable across trial roots.
    const files = await Promise.all(
      (await resourceFilesIn(destination)).map(async (path) => ({
        path: relative(destination, path),
        sha256: sha256(await readFile(path)),
        mode: (await stat(path)).mode & 0o777,
      })),
    );
    skillTrees.push({ sourcePath: skill.path, name: skill.name, scope: skill.scope, files });
    mappings.push({
      kind: 'skill',
      scope: skill.scope,
      sourcePath: skill.path,
      sourceSha256: skill.sha256,
      destinationPath,
      destinationSha256,
      origin: skill.origin,
      name: skill.name,
    });
  }
  const resourcePaths = [
    ...readableFiles,
    ...(await resourceFilesIn(skillsDirectory)),
    ...(await resourceFilesIn(join(paths.workspace, '.agents/skills'))),
  ];
  const resources = await Promise.all(
    resourcePaths.map(async (path) => ({
      path,
      sha256: sha256(await readFile(path)),
      kind: basename(path) === 'SKILL.md' ? 'skill' : 'instruction-or-resource',
    })),
  );
  const fixtureFiles = await Promise.all(
    (await resourceFilesIn(options.fixtureDirectory)).map(async (path) => ({
      path: path.slice(options.fixtureDirectory.length + 1),
      sha256: sha256(await readFile(path)),
    })),
  );
  return {
    readableFiles,
    skillsDirectory,
    resources,
    fixtureFiles,
    fixtureRevision: sha256(JSON.stringify(fixtureFiles)),
    originalInstructionSha256: sha256(original),
    effectiveInstructionSha256: sha256(effective),
    skillTreeFingerprint: sha256(
      JSON.stringify(skillTrees.map(({ name, scope, files }) => ({ name, scope, files }))),
    ),
    instructionChange:
      options.variant === 'disabled'
        ? { removed: VALIDATION_INSTRUCTION, source: 'AGENTS.md' }
        : null,
    sourceProfile: {
      cwd: native.cwd,
      projectTrusted: native.projectTrusted,
      mappings,
      skillTrees,
      excludedSkillCandidates: native.skillCandidates
        .filter((item) => !item.selected)
        .map((item) => item.path),
      deviations: [
        'Selected resources are relocated into the synthetic fixture; source-to-destination hashes and original scopes are recorded.',
        'Only natively selected skill winners are copied. Disabled, untrusted and shadowed skills are not rediscovered from their original directories.',
        'Package skill contents retain their source scope; optional package/extension code and prompt templates are suppressed.',
        'Selected skills use native default discovery after relocation. Original package/configuration origin and description ordering can differ; actual fixture discovery is verified and recorded.',
        'The synthetic fixture is explicitly trusted so its selected resources load. This does not change the source checkout trust or add its unselected resources.',
      ],
    },
  };
}

/** Re-run native discovery against the prepared profile before any agent prompt. */
export async function verifyPreparedResources(
  paths: TrialPaths,
  packageRoot: string,
  expected: PreparedResources,
  runtime: { executable: string; env: Record<string, string> },
) {
  const observed = await inspectPiResourcesInEnvironment({
    cwd: paths.workspace,
    agentDir: paths.piDirectory,
    packageRoot,
    ...runtime,
  });
  const actual = [
    ...observed.instructions.map((source) => ({ kind: 'instruction', source })),
    ...observed.systemPrompts.map((source) => ({ kind: 'system-prompt', source })),
    ...observed.skills.map((source) => ({ kind: 'skill', source })),
  ];
  if (
    actual.length !== expected.sourceProfile.mappings.length ||
    actual.some(
      ({ kind, source }) =>
        !expected.sourceProfile.mappings.some(
          (mapping) =>
            mapping.kind === kind &&
            mapping.destinationPath === source.path &&
            mapping.destinationSha256 === source.sha256 &&
            mapping.scope === source.scope,
        ),
    )
  ) {
    throw new Error(
      'Native Pi selected different resources in the prepared fixture. The controlled profile cannot preserve the inspected source selection; no agent prompt was sent.',
    );
  }
  return {
    projectTrusted: observed.projectTrusted,
    instructions: observed.instructions,
    systemPrompts: observed.systemPrompts,
    skills: observed.skills,
    skillDiagnostics: observed.skillDiagnostics,
  };
}
