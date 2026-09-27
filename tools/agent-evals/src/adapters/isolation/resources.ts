import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import type { TrialPaths } from './trial-paths.ts';
import type { TraceArtifact } from '../../domain/library.ts';
import { redact } from '../secrets.ts';
import {
  inspectPiResourcesInEnvironment,
  type inspectPiResources,
  type PiContextSource,
  type PiSource,
} from '../pi-inspection.ts';

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
  recordedContexts: Array<TraceArtifact & { kind: string }>;
  contextCaptureGaps: string[];
  readableFiles: string[];
  skillsDirectory: string;
  resources: Array<{ path: string; sha256: string; kind: string }>;
  skillTreeFingerprint: string;
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

/** Refuse resources inspected in a different checkout. */
export function validateResourceSelection(sourceRepo: string, native: NativeResources) {
  if (resolve(native.cwd) !== resolve(sourceRepo)) {
    throw new Error(
      'Pi resources were inspected in a different checkout. Inspect the evaluation source checkout before preparing its trial.',
    );
  }
  return {
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
  paths: Pick<TrialPaths, 'workspace' | 'piDirectory' | 'instructionAncestors'>;
  native: NativeResources;
}): Promise<PreparedResources> {
  const { paths, sourceRepo, native } = options;
  const selection = validateResourceSelection(sourceRepo, native);
  if (paths.instructionAncestors.length !== selection.ancestors.length) {
    throw new Error('The prepared workspace does not preserve the inspected instruction ancestry.');
  }
  const mappings: ResourceMapping[] = [];
  const recordedContexts: PreparedResources['recordedContexts'] = [];
  const contextCaptureGaps: string[] = [];
  const captureContext = (path: string, bytes: Buffer | string, kind: string) => {
    try {
      const content = redact(
        typeof bytes === 'string' ? bytes : new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      );
      if (content.includes('\0')) throw new Error('Binary resource');
      recordedContexts.push({
        id: `context-${recordedContexts.length + 1}`,
        path,
        kind,
        content,
        sha256: sha256(content),
      });
    } catch {
      contextCaptureGaps.push(
        `Non-text resource was fingerprinted but its contents were not captured: ${path}`,
      );
    }
  };
  const skillTrees: PreparedResources['sourceProfile']['skillTrees'] = [];
  const readableFiles: string[] = [];
  const copySelected = async (
    source: PiContextSource,
    destination: string,
    kind: ResourceMapping['kind'],
  ) => {
    const original = await verifiedContent(source);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, original);
    captureContext(source.path, original, `original-${kind}`);
    captureContext(destination, original, `effective-${kind}`);
    readableFiles.push(destination);
    mappings.push({
      kind,
      scope: source.scope,
      sourcePath: source.path,
      sourceSha256: source.sha256,
      destinationPath: destination,
      destinationSha256: sha256(original),
    });
  };

  for (const instruction of native.instructions) {
    const directory =
      instruction.scope === 'user'
        ? paths.piDirectory
        : instruction.scope === 'project'
          ? paths.workspace
          : paths.instructionAncestors[selection.ancestors.indexOf(instruction)]!;
    await copySelected(instruction, join(directory, basename(instruction.path)), 'instruction');
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
        `Resource projection requires a named SKILL.md resource; native Pi selected ${skill.path}.`,
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
      (await resourceFilesIn(destination)).map(async (path) => {
        const content = await readFile(path);
        const localPath = relative(destination, path);
        const kind = localPath === 'SKILL.md' ? 'skill' : 'skill-resource';
        captureContext(join(dirname(skill.path), localPath), content, `original-${kind}`);
        captureContext(path, content, `effective-${kind}`);
        return { path: localPath, sha256: sha256(content), mode: (await stat(path)).mode & 0o777 };
      }),
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
  return {
    recordedContexts,
    contextCaptureGaps,
    readableFiles,
    skillsDirectory,
    resources,
    skillTreeFingerprint: sha256(
      JSON.stringify(skillTrees.map(({ name, scope, files }) => ({ name, scope, files }))),
    ),
    sourceProfile: {
      cwd: native.cwd,
      projectTrusted: native.projectTrusted,
      mappings,
      skillTrees,
      excludedSkillCandidates: native.skillCandidates
        .filter((item) => !item.selected)
        .map((item) => item.path),
      deviations: [
        'Selected resources are relocated into the isolated repository workspace; source-to-destination hashes and original scopes are recorded.',
        'Only natively selected skill winners are copied. Disabled, untrusted and shadowed skills are not rediscovered from their original directories.',
        'Package skill contents retain their source scope; optional package/extension code and prompt templates are suppressed.',
        'Selected skills use native default discovery after relocation. Original package/configuration origin and description ordering can differ; actual workspace discovery is verified and recorded.',
        'The isolated workspace is explicitly trusted so its selected resources load. This does not change the source checkout trust or add its unselected resources.',
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
      'Native Pi selected different resources in the prepared workspace. The inspected source selection could not be preserved; no agent prompt was sent.',
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
