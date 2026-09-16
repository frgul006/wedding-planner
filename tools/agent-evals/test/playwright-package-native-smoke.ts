/** Explicit isolated app/browser probe. No Pi session, model prompt or grader API call. */
import assert from 'node:assert/strict';
import { access, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTask } from '../src/adapters/evaluation-config.ts';
import { inspectPiResources, locatePi } from '../src/adapters/pi-inspection.ts';
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
const trial = await prepareTrialEnvironment({
  sourceRepo,
  task: await loadTask(sourceRepo, 'repository-ui-copy'),
  variant: 'disabled',
  pi: { ...pi, agentDir, resources },
  runtimeMs: 120_000,
});
try {
  const boundary = JSON.parse(await readFile(trial.env.EVAL_ISOLATION_CONFIG, 'utf8'));
  const cache = boundary.toolEnv.PLAYWRIGHT_BROWSERS_PATH;
  assert.equal(typeof cache, 'string');
  const profile = await readFile(boundary.profilePath, 'utf8');
  assert.ok(
    !profile.includes(`(subpath ${JSON.stringify(cache)})`),
    'The whole browser cache must not be readable.',
  );
  const command = `
    (async () => {
      const { chromium, expect } = require('@playwright/test');
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.goto(${JSON.stringify(trial.url + '/admin/login')});
        await expect(page.getByRole('heading', { name: 'Admin login' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
        console.log('Default app Playwright launch and real login page passed.');
      } finally { await browser.close(); }
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `;
  const result = await trial.runCommand(process.execPath, ['-e', command]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /real login page passed/);
  console.log(result.stdout.trim());
  const denied = await trial.runCommand(process.execPath, [
    '-e',
    `require('node:fs').readdirSync(${JSON.stringify(cache)})`,
  ]);
  assert.notEqual(denied.exitCode, 0, 'The agent must not list unrelated browser installations.');
  console.log('Cache root remains inaccessible; only the pinned browser installation is readable.');
} finally {
  await trial.cleanup();
  for (const name of ['auth.json', 'models.json', 'models-store.json'])
    await assert.rejects(access(join(trial.root, 'control/pi', name)));
  await rm(trial.root, { recursive: true, force: true });
}
