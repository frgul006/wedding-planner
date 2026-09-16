/** Explicit real-repository/browser preflight; no Pi prompt or model/API generation. */
import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { locatePi, inspectPiResources } from '../src/adapters/pi-inspection.ts';
import { loadTask } from '../src/adapters/evaluation-config.ts';
import { prepareTrialEnvironment } from '../src/adapters/trial-environment.ts';

const sourceRepo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const agentSource = process.env.EVAL_AGENT_SOURCE ?? resolve(sourceRepo, '../../wedding-planner');
const pi = await locatePi();
const agentDir = join(process.env.HOME!, '.pi/agent');
const resources = await inspectPiResources({
  cwd: agentSource,
  packageRoot: pi.packageRoot,
  agentDir,
});
for (const taskId of ['repository-ui-copy', 'repository-login-error']) {
  const task = await loadTask(sourceRepo, taskId);
  const copy = taskId === 'repository-ui-copy';
  console.log(`Preparing pinned real Wedding checkout for ${taskId} (no model prompt).`);
  const trial = await prepareTrialEnvironment({
    sourceRepo,
    task,
    variant: 'enabled',
    pi: { ...pi, agentDir, resources },
    runtimeMs: 300_000,
  });
  console.log(`Prepared real repository at ${trial.workspace}; ${trial.url}`);
  try {
    const denied = await trial.runCommand('/bin/cat', [
      join(trial.root, 'control/repository-acceptance.mjs'),
    ]);
    assert.notEqual(denied.exitCode, 0, 'Agent tools must not read evaluator acceptance controls.');
    const dependencyWrite = await trial.runCommand('/bin/sh', [
      '-c',
      'echo forbidden > node_modules/.evaluation-write-probe',
    ]);
    assert.notEqual(
      dependencyWrite.exitCode,
      0,
      'Agent tools must not modify installed dependencies.',
    );
    const broken = await trial.verifyAcceptance!();
    assert.notEqual(broken.exitCode, 0, 'The unchanged authored task must fail acceptance.');
    assert.match(
      broken.stderr,
      copy ? /requested visible submit button label/ : /visible|Timeout/,
      'Baseline must fail for the authored defect, not infrastructure failure.',
    );
    console.log(`${taskId}: unchanged target correctly rejected.`);
    const target = join(trial.workspace, task.targetFile);
    const original = await readFile(target, 'utf8');
    const needle = copy
      ? '{pending ? "Signing in..." : "Sign in"}'
      : 'className="hidden rounded-lg bg-red-50';
    const replacement = copy
      ? '{pending ? "Signing in..." : "Sign in to manage the wedding"}'
      : 'className="rounded-lg bg-red-50';
    assert.equal(original.split(needle).length, 2, 'The intended one-line change must be unique.');
    await writeFile(target, original.replace(needle, replacement));
    const navigation = await trial.runCommand('playwright-cli', [
      'open',
      trial.url + '/admin/login',
    ]);
    assert.equal(navigation.exitCode, 0, navigation.stderr);
    const snapshot = await trial.runCommand('playwright-cli', ['snapshot']);
    assert.equal(snapshot.exitCode, 0, snapshot.stderr);
    const staleCache = join(trial.workspace, '.next/agent-generated-cache-marker');
    await writeFile(staleCache, 'Agent-generated output must not survive trusted acceptance.');
    console.log(`${taskId}: running fresh-cache independent lint/build/browser checks.`);
    const final = await trial.finalize!();
    await assert.rejects(access(staleCache), { code: 'ENOENT' });
    const destination = join(sourceRepo, 'evals/runs/repository-native-preflight');
    await mkdir(destination, { recursive: true });
    const filename = copy ? 'observations-ui-copy.json' : 'observations.json';
    await writeFile(
      join(destination, filename),
      JSON.stringify(
        { taskId, provenance: trial.provenance, broken, navigation, snapshot, final },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify(
        final.checks?.map(({ id, status, stderr, stdout }) => ({
          id,
          status,
          stderr: stderr.slice(-2000),
          stdout: stdout.slice(-2000),
        })),
        null,
        2,
      ),
    );
    assert.ok(
      final.checks?.every((check) => check.status === 'pass'),
      'Every final check must pass after the intended change.',
    );
    assert.deepEqual(final.changedFiles, [task.targetFile]);
    assert.match(
      final.patch!.content,
      copy ? /Sign in to manage the wedding/ : /hidden rounded-lg/,
    );
    console.log(
      `${taskId}: real repository red/green preflight passed. Evidence: ${destination}/${filename}`,
    );
  } finally {
    await trial.cleanup();
  }
}
