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
import { compareTrials } from '../src/domain/comparison.ts';
import {
  prepareResources,
  sha256,
  validateResourceSelection,
  VALIDATION_INSTRUCTION,
} from '../src/adapters/isolation/resources.ts';
import type {
  PiContextSource,
  PiSkillSource,
  inspectPiResources,
} from '../src/adapters/pi-inspection.ts';

type NativeResources = Awaited<ReturnType<typeof inspectPiResources>>;

async function selectedFile(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  return { path, realPath: await realpath(path), sha256: sha256(content) };
}

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'eval-resource-projection-')));
  const sourceRepo = join(root, 'source');
  const fixtureDirectory = join(root, 'fixture');
  const project: PiContextSource = {
    ...(await selectedFile(
      join(sourceRepo, 'AGENTS.md'),
      `# Project\n\n${VALIDATION_INSTRUCTION}\n`,
    )),
    scope: 'project',
  };
  await selectedFile(join(fixtureDirectory, 'index.html'), '<h1>Synthetic fixture</h1>');
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
  return { root, sourceRepo, fixtureDirectory, paths, native, variant: 'enabled' as const };
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

test('ancestor contexts preserve native order and the disabled variant changes only the selected pilot paragraph', async () => {
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
    const prepared = await prepareResources({ ...setup, variant: 'disabled' });
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
      '# Project\n\n\n',
    );
    assert.equal(
      prepared.sourceProfile.mappings.filter((item) => item.destinationSha256 !== item.sourceSha256)
        .length,
      1,
    );
  } finally {
    await rm(setup.root, { recursive: true, force: true });
  }
});

test('untrusted source skills stay unavailable even when the synthetic fixture is trusted', async () => {
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

test('a different inspected checkout or shadowed pilot rule fails before projection', async () => {
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
          VALIDATION_INSTRUCTION,
        )),
        scope: 'project',
      },
    ];
    await assert.rejects(prepareResources(setup), /shadowed or unavailable/);
    await assert.rejects(access(setup.paths.workspace));
  } finally {
    await rm(setup.root, { recursive: true, force: true });
  }
});

test('resource drift and fixture-authored instructions cannot silently change the inspected profile', async () => {
  const setup = await fixture();
  try {
    await writeFile(join(setup.sourceRepo, 'AGENTS.md'), '# Changed after inspection');
    await assert.rejects(prepareResources(setup), /changed after inspection/);
    await selectedFile(join(setup.fixtureDirectory, 'AGENTS.override.md'), '# Fixture injection');
    await rm(setup.paths.workspace, { recursive: true, force: true });
    await assert.rejects(prepareResources(setup), /competing agent resources/);
  } finally {
    await rm(setup.root, { recursive: true, force: true });
  }
});

test('controlled pairs fingerprint copied skill helpers while ignoring omitted files and trial roots', async () => {
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
    const prepare = (name: string, variant: 'enabled' | 'disabled') =>
      prepareResources({
        ...setup,
        variant,
        paths: {
          workspace: join(setup.root, name, 'workspace'),
          piDirectory: join(setup.root, name, 'pi'),
          instructionAncestors: [],
        },
      });

    const enabled = await prepare('first-trial', 'enabled');
    for (const file of excluded) await writeFile(join(sourceDirectory, file), 'Excluded v2');
    await writeFile(symlinkTarget, 'Changed outside approved root');
    const disabled = await prepare('second-trial', 'disabled');
    const comparable = (variant: string, skillTreeFingerprint: string) => ({
      variant,
      comparisonEligible: true,
      invariants: { skillTreeFingerprint },
    });
    assert.deepEqual(
      enabled.sourceProfile.skillTrees[0]!.files.map((file) => file.path),
      ['SKILL.md', 'references/check.md'],
      'the fingerprint includes only the exact files made available to the agent',
    );
    assert.notEqual(enabled.effectiveInstructionSha256, disabled.effectiveInstructionSha256);
    assert.equal(
      compareTrials(
        comparable('enabled', enabled.skillTreeFingerprint),
        comparable('disabled', disabled.skillTreeFingerprint),
      ).eligible,
      true,
      'temporary relocation and the intended paragraph change do not break a matched pair',
    );

    await writeFile(helper, 'Changed helper with unchanged SKILL.md');
    const changed = await prepare('changed-helper-trial', 'disabled');
    assert.equal(changed.sourceProfile.mappings[1]!.sourceSha256, skill.sha256);
    assert.equal(
      compareTrials(
        comparable('enabled', enabled.skillTreeFingerprint),
        comparable('disabled', changed.skillTreeFingerprint),
      ).eligible,
      false,
      'a global package helper change must prevent a controlled comparison',
    );

    await chmod(helper, 0o755);
    const executable = await prepare('changed-mode-trial', 'disabled');
    assert.notEqual(changed.skillTreeFingerprint, executable.skillTreeFingerprint);
  } finally {
    await rm(setup.root, { recursive: true, force: true });
  }
});
