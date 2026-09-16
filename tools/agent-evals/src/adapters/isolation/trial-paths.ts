import { mkdir, mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Writable agent files occupy separate directories from private evaluator controls. */
export interface TrialPaths {
  root: string;
  workspace: string;
  toolHome: string;
  temporary: string;
  control: string;
  piDirectory: string;
  privateFiles: string[];
  runtimeBin: string;
  browserConfig: string;
  profile: string;
  boundaryConfig: string;
  extension: string;
  fileWorker: string;
  processRegistry: string;
  snapshotReceipts: string;
  preflight: string;
  instructionAncestors: string[];
}

export async function createTrialPaths(ancestorCount = 0): Promise<TrialPaths> {
  // Keep native macOS Unix-socket paths short; filesystem-only tests also run on Linux.
  const temporaryRoot = process.platform === 'darwin' ? '/private/tmp' : tmpdir();
  const root = await realpath(await mkdtemp(join(temporaryRoot, 'wedding-eval-')));
  const control = join(root, 'control');
  const piDirectory = join(control, 'pi');
  const instructionAncestors: string[] = [];
  let workspaceParent = root;
  for (let index = 0; index < ancestorCount; index++) {
    workspaceParent = join(workspaceParent, `context-${index + 1}`);
    instructionAncestors.push(workspaceParent);
  }
  const paths: TrialPaths = {
    root,
    control,
    piDirectory,
    workspace: join(workspaceParent, 'workspace'),
    instructionAncestors,
    toolHome: join(root, 'home'),
    temporary: join(root, 'tmp'),
    privateFiles: ['auth.json', 'models.json', 'models-store.json'].map((name) =>
      join(piDirectory, name),
    ),
    runtimeBin: join(control, 'runtime-bin'),
    browserConfig: join(control, 'browser.config.json'),
    profile: join(control, 'sandbox.sb'),
    boundaryConfig: join(control, 'boundary.json'),
    extension: join(control, 'pi-tool-boundary.mjs'),
    fileWorker: join(control, 'file-worker.mjs'),
    processRegistry: join(control, 'process-groups.jsonl'),
    snapshotReceipts: join(control, 'snapshot-receipts'),
    preflight: join(control, 'preflight.json'),
  };
  await Promise.all(
    [
      paths.workspace,
      paths.toolHome,
      paths.temporary,
      paths.piDirectory,
      paths.runtimeBin,
      paths.snapshotReceipts,
      join(control, 'tmp'),
    ].map((directory) => mkdir(directory, { recursive: true })),
  );
  return paths;
}
