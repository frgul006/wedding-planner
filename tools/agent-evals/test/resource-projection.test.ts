import assert from 'node:assert/strict';
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import {
  prepareResources,
  sha256,
  validateResourceSelection,
} from '../src/adapters/isolation/resources.ts';
import type {
  PiContextSource,
  PiSkillSource,
  inspectPiResources,
} from '../src/adapters/pi-inspection.ts';

type NativeResources = Awaited<ReturnType<typeof inspectPiResources>>;
const projectInstruction = '# Project\n\nPreserve this complete instruction text.\n';

async function selectedFile(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  return { path, realPath: await realpath(path), sha256: sha256(content) };
}

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'eval-resource-projection-')));
  const sourceRepo = join(root, 'source');
  const project: PiContextSource = {
    ...(await selectedFile(join(sourceRepo, 'AGENTS.md'), projectInstruction)),
    scope: 'project',
  };
  const paths = {
    workspace: join(root, 'trial/workspace'),
    piDirectory: join(root, 'trial/control/pi'),
    instructionAncestors: [] as string[],
  };
  await mkdir(paths.piDirectory, { recursive: true });
  const native: NativeResources = {
    cwd: sourceRepo,
    projectTrusted: true,
    savedTrust: true,
    instructions: [project],
    skills: [],
    skillCandidates: [],
    extensions: [],
    prompts: [],
    systemPrompts: [],
    skillDiagnostics: [],
    missingPackages: [],
    duplicateInstructionSources: [],
    metadataSource: 'Authored offline selection',
  };
  return { root, sourceRepo, paths, native };
}

test('only native selected skills are copied and their scope never depends on path prefixes', async () => {
  const setup = await fixture();
  try {
    // A project setting may deliberately select a file outside its checkout.
    const winner: PiSkillSource = {
      ...(await selectedFile(
        join(setup.root, 'original-checkout/diagnose/SKILL.md'),
        '# Winning diagnose',
      )),
      name: 'diagnose',
      scope: 'project',
      source: 'local',
      origin: 'top-level',
    };
    const shadowed = await selectedFile(
      join(setup.root, 'user-skills/diagnose/SKILL.md'),
      '# Shadowed diagnose',
    );
    await selectedFile(
      join(setup.sourceRepo, '.agents/skills/disabled/SKILL.md'),
      '# Disabled skill',
    );
    setup.native.skills = [winner];
    setup.native.skillCandidates = [
      { ...winner, selected: true },
      { ...shadowed, selected: false },
    ];
    const prepared = await prepareResources(setup);
    assert.equal(
      await readFile(join(setup.paths.workspace, '.agents/skills/diagnose/SKILL.md'), 'utf8'),
      '# Winning diagnose',
    );
    await assert.rejects(access(join(prepared.skillsDirectory, 'diagnose/SKILL.md')));
    await assert.rejects(access(join(setup.paths.workspace, '.agents/skills/disabled/SKILL.md')));
    assert.deepEqual(prepared.sourceProfile.excludedSkillCandidates, [shadowed.path]);
    assert.equal(
      prepared.sourceProfile.mappings.find((item) => item.kind === 'skill')?.scope,
      'project',
    );
  } finally {
    await rm(setup.root, { recursive: true, force: true });
  }
});

test('historical contexts retain original and effective instructions and referenced skill text', async () => {
  const setup = await fixture();
  try {
    const skill: PiSkillSource = {
      ...(await selectedFile(
        join(setup.sourceRepo, '.agents/skills/diagnose/SKILL.md'),
        '# Diagnose\nSee [guide](guide.md).',
      )),
      name: 'diagnose',
      scope: 'project',
      source: 'local',
      origin: 'top-level',
    };
    await selectedFile(join(dirname(skill.path), 'guide.md'), 'Predict a falsifiable result.');
    await writeFile(join(dirname(skill.path), 'binary.dat'), Buffer.from([0xff, 0x00]));
    setup.native.skills = [skill];
    const prepared = await prepareResources(setup);
    const original = prepared.recordedContexts.find(
      (context) => context.kind === 'original-instruction',
    );
    const effective = prepared.recordedContexts.find(
      (context) => context.kind === 'effective-instruction',
    );
    assert.equal(original?.content, projectInstruction);
    assert.equal(effective?.content, projectInstruction);
    assert.ok(
      prepared.recordedContexts.some(
        (context) =>
          context.kind === 'effective-skill-resource' &&
          context.content === 'Predict a falsifiable result.',
      ),
    );
    await writeFile(skill.path, 'Changed after capture');
    assert.ok(
      prepared.recordedContexts.some(
        (context) => context.kind === 'original-skill' && context.content.includes('# Diagnose'),
      ),
    );
    assert.ok(prepared.contextCaptureGaps.some((gap) => gap.includes('binary.dat')));
    for (const context of prepared.recordedContexts)
      assert.equal(context.sha256, sha256(context.content));
    assert.equal(
      new Set(prepared.recordedContexts.map((context) => context.id)).size,
      prepared.recordedContexts.length,
    );
  } finally {
    await rm(setup.root, { recursive: true, force: true });
  }
});

test('winning global override and system prompt filenames survive with project prompt precedence', async () => {
  const setup = await fixture();
  try {
    const global: PiContextSource = {
      ...(await selectedFile(
        join(setup.root, 'user/AGENTS.override.md'),
        '# Winning global override',
      )),
      scope: 'user',
    };
    await selectedFile(join(setup.root, 'user/AGENTS.md'), '# Shadowed global context');
    const system: PiContextSource = {
      ...(await selectedFile(join(setup.root, 'user/SYSTEM.md'), 'Selected system prompt')),
      scope: 'user',
    };
    const append: PiContextSource = {
      ...(await selectedFile(
        join(setup.sourceRepo, '.pi/APPEND_SYSTEM.md'),
        'Selected project append',
      )),
      scope: 'project',
    };
    await selectedFile(join(setup.root, 'user/APPEND_SYSTEM.md'), 'Shadowed global append');
    setup.native.instructions.unshift(global);
    setup.native.systemPrompts = [system, append];
    await prepareResources(setup);
    assert.equal(
      await readFile(join(setup.paths.piDirectory, 'AGENTS.override.md'), 'utf8'),
      '# Winning global override',
    );
    assert.equal(
      await readFile(join(setup.paths.piDirectory, 'SYSTEM.md'), 'utf8'),
      'Selected system prompt',
    );
    assert.equal(
      await readFile(join(setup.paths.workspace, '.pi/APPEND_SYSTEM.md'), 'utf8'),
      'Selected project append',
    );
    await assert.rejects(access(join(setup.paths.piDirectory, 'AGENTS.md')));
    await assert.rejects(access(join(setup.paths.piDirectory, 'APPEND_SYSTEM.md')));
  } finally {
    await rm(setup.root, { recursive: true, force: true });
  }
});

test('ancestor contexts preserve native order and all instruction bytes', async () => {
  const setup = await fixture();
  try {
    const outer: PiContextSource = {
      ...(await selectedFile(join(setup.root, 'ancestor/AGENTS.override.md'), '# Outer context')),
      scope: 'ancestor',
    };
    const inner: PiContextSource = {
      ...(await selectedFile(join(setup.root, 'ancestor/inner/CLAUDE.md'), '# Inner context')),
      scope: 'ancestor',
    };
    setup.native.instructions.unshift(outer, inner);
    setup.paths.instructionAncestors = [
      join(setup.root, 'trial/context-1'),
      join(setup.root, 'trial/context-1/context-2'),
    ];
    setup.paths.workspace = join(setup.paths.instructionAncestors[1]!, 'workspace');
    const prepared = await prepareResources(setup);
    assert.equal(
      await readFile(join(setup.paths.instructionAncestors[0]!, 'AGENTS.override.md'), 'utf8'),
      '# Outer context',
    );
    assert.equal(
      await readFile(join(setup.paths.instructionAncestors[1]!, 'CLAUDE.md'), 'utf8'),
      '# Inner context',
    );
    assert.equal(
      await readFile(join(setup.paths.workspace, 'AGENTS.md'), 'utf8'),
      projectInstruction,
    );
    assert.equal(
      prepared.sourceProfile.mappings.filter((item) => item.destinationSha256 !== item.sourceSha256)
        .length,
      0,
    );
  } finally {
    await rm(setup.root, { recursive: true, force: true });
  }
});

test('untrusted source skills stay unavailable even when the isolated workspace is trusted', async () => {
  const setup = await fixture();
  try {
    setup.native.projectTrusted = false;
    setup.native.savedTrust = false;
    await selectedFile(
      join(setup.sourceRepo, '.agents/skills/diagnose/SKILL.md'),
      '# Not selected',
    );
    const prepared = await prepareResources(setup);
    await assert.rejects(access(join(setup.paths.workspace, '.agents')));
    assert.equal(prepared.sourceProfile.projectTrusted, false);
    assert.ok(
      prepared.sourceProfile.deviations.some((item) => item.includes('explicitly trusted')),
    );
  } finally {
    await rm(setup.root, { recursive: true, force: true });
  }
});

test('a different inspected checkout fails while native project override winners are preserved', async () => {
  const setup = await fixture();
  try {
    assert.throws(
      () => validateResourceSelection(join(setup.root, 'different'), setup.native),
      /different checkout/,
    );
    setup.native.instructions = [
      {
        ...(await selectedFile(
          join(setup.sourceRepo, 'AGENTS.override.md'),
          '# Native override without a pilot paragraph',
        )),
        scope: 'project',
      },
    ];
    await prepareResources(setup);
    assert.equal(
      await readFile(join(setup.paths.workspace, 'AGENTS.override.md'), 'utf8'),
      '# Native override without a pilot paragraph',
    );
    await assert.rejects(access(join(setup.paths.workspace, 'AGENTS.md')));
  } finally {
    await rm(setup.root, { recursive: true, force: true });
  }
});

test('resource drift cannot silently change the inspected profile', async () => {
  const setup = await fixture();
  try {
    await writeFile(join(setup.sourceRepo, 'AGENTS.md'), '# Changed after inspection');
    await assert.rejects(prepareResources(setup), /changed after inspection/);
  } finally {
    await rm(setup.root, { recursive: true, force: true });
  }
});

test('skill fingerprints track copied helpers while ignoring omitted files and trial roots', async () => {
  const setup = await fixture();
  try {
    const sourceDirectory = join(setup.root, 'global-package/skill');
    const skill: PiSkillSource = {
      ...(await selectedFile(join(sourceDirectory, 'SKILL.md'), '# Read references/check.md')),
      name: 'review',
      scope: 'user',
      source: 'npm:review',
      origin: 'package',
    };
    setup.native.skills = [skill];
    const helper = join(sourceDirectory, 'references/check.md');
    await selectedFile(helper, 'First helper version');
    const excluded = ['.env.local', 'auth.json', 'node_modules/tool.js', '.git/config'];
    for (const file of excluded) await selectedFile(join(sourceDirectory, file), 'Excluded v1');
    const symlinkTarget = join(setup.root, 'outside-reference.md');
    await selectedFile(symlinkTarget, 'Outside approved root');
    await symlink(symlinkTarget, join(sourceDirectory, 'linked-reference.md'));
    const prepare = (name: string) =>
      prepareResources({
        ...setup,
        paths: {
          workspace: join(setup.root, name, 'workspace'),
          piDirectory: join(setup.root, name, 'pi'),
          instructionAncestors: [],
        },
      });

    const first = await prepare('first-trial');
    for (const file of excluded) await writeFile(join(sourceDirectory, file), 'Excluded v2');
    await writeFile(symlinkTarget, 'Changed outside approved root');
    const second = await prepare('second-trial');
    assert.deepEqual(
      first.sourceProfile.skillTrees[0]!.files.map((file) => file.path),
      ['SKILL.md', 'references/check.md'],
      'the fingerprint includes only the exact files made available to the agent',
    );
    assert.equal(
      first.skillTreeFingerprint,
      second.skillTreeFingerprint,
      'temporary relocation and excluded files do not affect available skill content',
    );

    await writeFile(helper, 'Changed helper with unchanged SKILL.md');
    const changed = await prepare('changed-helper-trial');
    assert.equal(changed.sourceProfile.mappings[1]!.sourceSha256, skill.sha256);
    assert.notEqual(
      first.skillTreeFingerprint,
      changed.skillTreeFingerprint,
      'a global package helper change must change the fingerprint',
    );

    await chmod(helper, 0o755);
    const executable = await prepare('changed-mode-trial');
    assert.notEqual(changed.skillTreeFingerprint, executable.skillTreeFingerprint);
  } finally {
    await rm(setup.root, { recursive: true, force: true });
  }
});
