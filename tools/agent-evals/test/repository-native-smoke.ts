/** Explicit repository/browser/tool-boundary preflight; no model or grader generation. */
import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { locatePi, inspectPiResources } from '../src/adapters/pi-inspection.ts';
import { loadTask } from '../src/adapters/evaluation-config.ts';
import { prepareTrialEnvironment } from '../src/adapters/trial-environment.ts';
import { resolveSourceRepo } from '../src/adapters/secrets.ts';

const sourceRepo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const agentSource = process.env.EVAL_AGENT_SOURCE ?? resolveSourceRepo(sourceRepo);
const pi = await locatePi();
const agentDir = join(process.env.HOME!, '.pi/agent');
const resources = await inspectPiResources({
  cwd: agentSource,
  packageRoot: pi.packageRoot,
  agentDir,
});
const task = await loadTask(sourceRepo, 'repository-login-retry');
console.log(`Preparing pinned Wedding checkout for ${task.id} (no model prompt).`);
const trial = await prepareTrialEnvironment({
  sourceRepo,
  task,
  pi: { ...pi, agentDir, resources },
  runtimeMs: 300_000,
});
const previousConfig = process.env.EVAL_ISOLATION_CONFIG;
process.env.EVAL_ISOLATION_CONFIG = trial.env.EVAL_ISOLATION_CONFIG;
const observations: unknown[] = [];
try {
  const { default: install } = await import(join(trial.root, 'control/pi-tool-boundary.mjs'));
  const tools = new Map<
    string,
    { execute: (...args: unknown[]) => Promise<Record<string, unknown>> }
  >();
  const commands = new Set<string>();
  await install({
    registerTool(tool: {
      name: string;
      execute: (...args: unknown[]) => Promise<Record<string, unknown>>;
    }) {
      tools.set(tool.name, tool);
    },
    registerCommand(name: string) {
      commands.add(name);
    },
    on() {},
  });
  assert.ok(commands.has('eval-sandbox-ready-v1'));
  assert.deepEqual([...tools.keys()].sort(), ['bash', 'edit', 'read', 'write']);
  let call = 0;
  const invoke = async (name: string, params: unknown) => {
    const result = await tools
      .get(name)!
      .execute(`preflight-${++call}`, params, undefined, undefined, { cwd: trial.workspace });
    observations.push({ name, params, result });
    return result;
  };
  const canary = join(trial.root, 'control/canary.txt');
  await writeFile(canary, 'ISOLATION_CANARY');
  const deniedRead = await invoke('read', { path: canary });
  assert.equal(deniedRead.isError, true);
  assert.ok(!JSON.stringify(deniedRead).includes('ISOLATION_CANARY'));
  const deniedAcceptance = await trial.runCommand('/bin/cat', [
    join(trial.root, 'control/repository-acceptance.mjs'),
  ]);
  assert.notEqual(
    deniedAcceptance.exitCode,
    0,
    'Agent tools must not read evaluator acceptance controls.',
  );
  const deniedDependencyWrite = await trial.runCommand('/bin/sh', [
    '-c',
    'echo forbidden > node_modules/.evaluation-write-probe',
  ]);
  assert.notEqual(
    deniedDependencyWrite.exitCode,
    0,
    'Agent tools must not modify installed dependencies.',
  );
  const sourceRead = await invoke('read', { path: task.targetFile });
  assert.ok(!sourceRead.isError, JSON.stringify(sourceRead));
  const source = await readFile(join(trial.workspace, task.targetFile), 'utf8');
  const unchangedWrite = await invoke('write', { path: task.targetFile, content: source });
  assert.ok(!unchangedWrite.isError, JSON.stringify(unchangedWrite));
  const git = await invoke('bash', { command: 'git status --short', timeout: 20 });
  assert.ok(!git.isError, JSON.stringify(git));

  const broken = await trial.verifyAcceptance!();
  assert.notEqual(broken.exitCode, 0, 'The seeded login retry defect must fail acceptance.');
  assert.match(
    broken.stderr,
    /Failed sign-in must allow another attempt/,
    'Baseline must fail for the authored defect, not infrastructure failure.',
  );
  const needle = 'disabled={pending || Boolean(state.error)}';
  assert.equal(source.split(needle).length, 2, 'The intended one-line change must be unique.');
  const repair = await invoke('edit', {
    path: task.targetFile,
    edits: [{ oldText: needle, newText: 'disabled={pending}' }],
  });
  assert.ok(!repair.isError, JSON.stringify(repair));
  const navigation = await trial.runCommand('playwright-cli', ['open', trial.url + '/admin/login']);
  assert.equal(navigation.exitCode, 0, navigation.stderr);
  const interaction = await trial.runCommand('playwright-cli', [
    'run-code',
    `async page => {
      for (const password of ['first-invalid-password', 'retry-invalid-password']) {
        await page.getByLabel('Email', { exact: true }).fill('evaluation@example.invalid');
        await page.getByLabel('Password', { exact: true }).fill(password);
        const response = page.waitForResponse(r => r.request().method() === 'POST' && r.url().split('?')[0].endsWith('/admin/login'));
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        await response;
        await page.getByRole('alert').filter({ hasText: 'Invalid email or password.' }).waitFor({ state: 'visible' });
        await page.getByRole('button', { name: 'Sign in', exact: true }).click({ trial: true, timeout: 10000 });
      }
    }`,
  ]);
  assert.equal(interaction.exitCode, 0, interaction.stderr + interaction.stdout);
  assert.doesNotMatch(interaction.stdout, /### Error/);
  const snapshot = await trial.runCommand('playwright-cli', ['snapshot']);
  assert.equal(snapshot.exitCode, 0, snapshot.stderr);
  const staleCache = join(trial.workspace, '.next/agent-generated-cache-marker');
  await writeFile(staleCache, 'Agent-generated output must not survive trusted acceptance.');
  console.log('Running fresh-cache independent lint/build/browser checks.');
  const final = await trial.finalize!();
  await assert.rejects(access(staleCache), { code: 'ENOENT' });
  const destination = join(sourceRepo, `evals/runs/repository-native-preflight-${Date.now()}`);
  await mkdir(destination, { recursive: true });
  await writeFile(
    join(destination, 'observations-login-retry.json'),
    JSON.stringify(
      {
        taskId: task.id,
        provenance: trial.provenance,
        observations,
        broken,
        navigation,
        interaction,
        snapshot,
        final,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      final.checks?.map(({ id, status }) => ({ id, status })),
      null,
      2,
    ),
  );
  assert.ok(
    final.checks?.every((check) => check.status === 'pass'),
    'Every final check must pass after the intended change.',
  );
  assert.deepEqual(final.changedFiles, [task.targetFile]);
  assert.match(final.patch!.content, /disabled=\{pending \|\| Boolean\(state.error\)\}/);
  console.log(
    `Repository red/green and tool-boundary preflight passed. Evidence: ${destination}/observations-login-retry.json`,
  );
} finally {
  try {
    await trial.cleanup();
  } finally {
    if (previousConfig === undefined) delete process.env.EVAL_ISOLATION_CONFIG;
    else process.env.EVAL_ISOLATION_CONFIG = previousConfig;
  }
}
for (const name of ['auth.json', 'models.json', 'models-store.json'])
  await assert.rejects(access(join(trial.root, 'control/pi', name)));
await assert.rejects(fetch(trial.url));
console.log('Cleanup verified: private Pi configuration removed; local server stopped.');
