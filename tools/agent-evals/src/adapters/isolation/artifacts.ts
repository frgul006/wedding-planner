import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Artifact } from '../../domain/types.ts';
import type { RunSandboxedCommand } from './boundary.ts';
import { resourceFilesIn, sha256 } from './resources.ts';
import { safeFile } from './sandbox.ts';
import type { TrialPaths } from './trial-paths.ts';

interface CapturedContent {
  path: string;
  content: string;
  sha256: string;
}

async function captureWorkspaceFile(
  candidate: string,
  paths: TrialPaths,
  nodeExecutable: string,
  run: RunSandboxedCommand,
): Promise<CapturedContent | undefined> {
  try {
    const file = await safeFile(paths.workspace, candidate);
    const info = await stat(file);
    if (info.size > 256_000 || !/\.(md|html|ya?ml|json|log|txt|[cm]?[jt]sx?|css)$/.test(file))
      return;
    const result = await run(nodeExecutable, [paths.fileWorker, 'read', file], 5000);
    if (result.exitCode !== 0) return;
    return { path: candidate, content: result.stdout, sha256: sha256(result.stdout) };
  } catch {
    /* A missing or escaping workspace file is not evidence. */
  }
}

function parseSnapshotReceipt(serialized: string): CapturedContent {
  const receipt = JSON.parse(serialized) as Partial<CapturedContent>;
  if (
    typeof receipt.path !== 'string' ||
    typeof receipt.content !== 'string' ||
    typeof receipt.sha256 !== 'string' ||
    receipt.sha256 !== sha256(receipt.content)
  ) {
    throw new Error('Captured snapshot receipt failed its integrity check.');
  }
  return { path: receipt.path, content: receipt.content, sha256: receipt.sha256 };
}

/** Capture final files through the sandbox, plus private immutable browser receipts. */
export async function collectTrialArtifacts(options: {
  paths: TrialPaths;
  targetFile: string;
  nodeExecutable: string;
  run: RunSandboxedCommand;
}): Promise<Artifact[]> {
  const { paths } = options;
  const snapshots = await resourceFilesIn(join(paths.workspace, '.playwright-cli'));
  const candidates = [
    options.targetFile,
    ...snapshots.map((path) => path.slice(paths.workspace.length + 1)),
  ];
  const artifacts: Artifact[] = [];
  const append = (content: CapturedContent) =>
    artifacts.push({
      ...content,
      id: `artifact-${artifacts.length + 1}`,
      observedBy: 'evaluator',
    });
  for (const candidate of candidates) {
    const captured = await captureWorkspaceFile(
      candidate,
      paths,
      options.nodeExecutable,
      options.run,
    );
    if (captured) append(captured);
  }
  for (const file of await readdir(paths.snapshotReceipts)) {
    append(parseSnapshotReceipt(await readFile(join(paths.snapshotReceipts, file), 'utf8')));
  }
  return artifacts;
}
