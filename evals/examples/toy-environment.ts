import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EvaluationTask, Runner } from 'agent-evals';
import {
  piRunner,
  preparePiConfiguration,
  sha256,
  type Artifact,
  type PiEnvironmentContext,
  type PreparedEnvironment,
} from 'agent-evals/pi';
import { fixtureContent, fixturePath } from './fixture.ts';

/** Capture final file bytes before removing the trial workspace. */
export function toyObservation(
  root: string,
  workspace: string,
  taskId: string,
): Pick<PreparedEnvironment, 'collectArtifacts' | 'finalize' | 'cleanup'> {
  const collectArtifacts = async (): Promise<Artifact[]> => {
    if (taskId !== 'add-file-comment') {
      return [];
    }
    let content: string;
    try {
      content = await readFile(join(workspace, fixturePath), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
    return [
      {
        id: 'notes',
        path: fixturePath,
        content,
        sha256: sha256(content),
        observedBy: 'evaluator',
      },
    ];
  };
  return {
    collectArtifacts,
    finalize: async () => ({ artifacts: await collectArtifacts() }),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

async function prepareToyEnvironment({
  task,
  limits,
  pi,
}: PiEnvironmentContext): Promise<PreparedEnvironment> {
  const root = await mkdtemp(join(tmpdir(), 'agent-evals-example-'));
  const workspace = join(root, 'workspace');
  const piDirectory = join(root, 'private-pi');
  const home = join(root, 'home');
  try {
    await Promise.all([workspace, piDirectory, home].map((directory) => mkdir(directory)));
    if (task.id === 'add-file-comment') {
      await writeFile(join(workspace, fixturePath), fixtureContent);
    }
    const authentication = await preparePiConfiguration(
      pi,
      {
        piDirectory,
        privateFiles: ['auth.json', 'models.json', 'models-store.json'].map((name) =>
          join(piDirectory, name),
        ),
      },
      limits.runtimeMs,
    );
    return {
      root,
      workspace,
      env: {
        HOME: home,
        TMPDIR: root,
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        PI_CODING_AGENT_DIR: piDirectory,
        LANG: 'en_US.UTF-8',
        NO_COLOR: '1',
      },
      agentArgs: [
        '--no-extensions',
        '--no-skills',
        '--no-prompt-templates',
        '--no-context-files',
        ...(task.id === 'add-file-comment' ? ['--tools', 'read,edit,write'] : ['--no-tools']),
        '--approve',
      ],
      provenance: {
        recordedContexts: [],
        contextCaptureGaps: [],
        isolation: 'fresh-temporary-workspace',
        resourcePolicy: 'Native context files, skills, extensions and prompt templates suppressed.',
        toolPolicy: task.id === 'add-file-comment' ? 'read,edit,write' : 'none',
        authentication,
      },
      ...toyObservation(root, workspace, task.id),
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

/** Each run inspects an empty source, so Wedding's app configuration cannot enter these examples. */
export function toyRunner(recordingsDirectory: string): Runner {
  return {
    async run(task: EvaluationTask, options) {
      const source = await mkdtemp(join(tmpdir(), 'agent-evals-source-'));
      try {
        return await piRunner({
          agentSource: source,
          recordingsDirectory,
          model: 'gpt-6-luna',
          endpoint: 'catalog',
          billing: { type: 'subscription', maxEstimatedCostUsd: null },
          prepareEnvironment: prepareToyEnvironment,
        }).run(task, options);
      } finally {
        await rm(source, { recursive: true, force: true });
      }
    },
  };
}
