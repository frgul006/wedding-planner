/** Explicit offline integration verification: native Pi tools + local browser, no model calls. */
import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareTrialEnvironment } from '../src/adapters/trial-environment.js';
import { locatePi, inspectPiResources } from '../src/adapters/pi-inspection.js';
const sourceRepo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const pi = await locatePi();
const agentDir = join(process.env.HOME!, '.pi/agent');
const resources = await inspectPiResources({
  cwd: sourceRepo,
  packageRoot: pi.packageRoot,
  agentDir,
});
const trial = await prepareTrialEnvironment({
  sourceRepo,
  variant: 'enabled',
  pi: { ...pi, agentDir, resources },
  task: {
    id: 'native-tools-preflight',
    version: '1',
    kind: 'ui',
    targetFile: 'index.html',
    expectedText: '',
    flowPath: '/',
    prompt: '',
  },
});
const previousConfig = process.env.EVAL_ISOLATION_CONFIG;
process.env.EVAL_ISOLATION_CONFIG = trial.env.EVAL_ISOLATION_CONFIG;
const observations: unknown[] = [];
try {
  const preflight = trial.provenance.preflight as Array<{
    actor: string;
    exitCode: number;
    args: string[];
  }>;
  assert.equal(preflight.length, 4);
  assert.ok(
    preflight.every((command) => command.actor === 'environment' && command.exitCode === 0),
  );
  assert.deepEqual(
    preflight.map((command) => command.args),
    [['--version'], ['status', '--porcelain'], ['lint'], ['build']],
  );
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
  assert.equal(tools.size, 4);
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
  const denied = await invoke('read', { path: canary });
  assert.equal(denied.isError, true);
  assert.ok(!JSON.stringify(denied).includes('ISOLATION_CANARY'));
  for (const command of ['git --version', 'git status --short', 'pnpm lint', 'pnpm build']) {
    const result = await invoke('bash', { command, timeout: 20 });
    assert.ok(!result.isError, JSON.stringify(result));
  }
  const page = await readFile(join(trial.workspace, 'index.html'), 'utf8');
  const write = await invoke('write', {
    path: 'index.html',
    content: page.replace('>Details</a>', '>View the wedding schedule</a>'),
  });
  assert.ok(!write.isError);
  for (const command of [`playwright-cli open ${trial.url}`, 'playwright-cli snapshot']) {
    const result = await invoke('bash', { command, timeout: 20 });
    assert.ok(!result.isError, JSON.stringify(result));
  }
  const artifacts = await trial.collectArtifacts();
  const snapshot = artifacts.find((artifact) => artifact.path.startsWith('tool-output:'));
  assert.ok(snapshot);
  assert.match(snapshot.content, /View the wedding schedule/);
  const evidence = join(sourceRepo, 'evals/runs/native-tools-preflight');
  await mkdir(evidence, { recursive: true });
  await writeFile(
    join(evidence, 'observations.json'),
    JSON.stringify(
      { root: trial.root, url: trial.url, provenance: trial.provenance, observations, artifacts },
      null,
      2,
    ),
  );
  console.log(`Native tools preflight passed. Evidence: ${evidence}/observations.json`);
} finally {
  await trial.cleanup();
  if (previousConfig === undefined) delete process.env.EVAL_ISOLATION_CONFIG;
  else process.env.EVAL_ISOLATION_CONFIG = previousConfig;
}

for (const name of ['auth.json', 'models.json', 'models-store.json'])
  await assert.rejects(access(join(trial.root, 'control/pi', name)));
await assert.rejects(fetch(trial.url));
console.log(
  'Cleanup verified: private Pi credentials/model configuration removed; fixture server stopped.',
);
