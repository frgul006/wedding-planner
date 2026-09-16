import path from 'node:path';
import { loadProfile } from '../../adapters/evaluation-config.ts';
import { checkGraderModel } from '../../adapters/ai-sdk-grader.ts';
import { FileRunStore } from '../../adapters/file-run-store.ts';
import { resolveLocalRuntime } from '../../adapters/isolation/runtime.ts';
import { inspectPi } from '../../adapters/pi-inspection.ts';
import { loadGraderKey, safeError } from '../../adapters/secrets.ts';
import { timestampId, type CommandContext } from '../context.ts';
import { agentSource, graderEnvFile, profileOverrides } from '../live-plan.ts';
import { table } from '../output.ts';

interface Check {
  name: string;
  status: 'pass' | 'fail' | 'skipped';
  detail: string;
  remedy?: string;
}

export async function doctorCommand(context: CommandContext): Promise<number> {
  const { repo, request, output } = context;
  const profile = await loadProfile(repo, request.values.profile, profileOverrides(context));
  const keyFile = graderEnvFile(context);
  const source = agentSource(context);
  const useGrader = Boolean(request.values.semantic);
  let key = '';
  const [runtime, pi, grader] = await output.during(
    'Checking local runtime, native Pi and selected grader access…',
    () =>
      Promise.allSettled([
        resolveLocalRuntime(repo),
        inspectPi({ cwd: source }),
        !useGrader
          ? Promise.resolve(null)
          : (async () => {
              key = await loadGraderKey(keyFile);
              return checkGraderModel(key, profile.grader.model, context.signal);
            })(),
      ]),
  );
  const checks: Check[] = [];
  if (runtime.status === 'fulfilled') {
    checks.push({
      name: 'Local runtime',
      status: 'pass',
      detail: `Node ${runtime.value.node.version}, pnpm ${runtime.value.pnpm.version}, playwright ${runtime.value.playwright.version}, ${runtime.value.architecture}`,
    });
  } else {
    checks.push({
      name: 'Local runtime',
      status: 'fail',
      detail: safeError(runtime.reason),
      remedy:
        'Use the repository Node version (nvm use), install its pinned pnpm and playwright-cli, and install Chromium headless shell. See evals/README.md.',
    });
  }
  if (pi.status === 'fulfilled') {
    const settings = pi.value.defaults;
    const provider = typeof settings.provider === 'string' ? settings.provider : 'unknown';
    const model = typeof settings.model === 'string' ? settings.model : 'unknown';
    const thinking =
      typeof settings.thinkingLevel === 'string' ? settings.thinkingLevel : 'unknown';
    const subscriptionValid =
      profile.agentBilling !== 'subscription' ||
      (settings.provider === 'openai-codex' && pi.value.authentication.type === 'oauth');
    checks.push({
      name: 'Native Pi',
      status: subscriptionValid ? 'pass' : 'fail',
      detail: `${provider}/${model} · ${thinking} · Pi ${pi.value.version}`,
      ...(subscriptionValid
        ? {}
        : {
            remedy:
              'The subscription profile requires openai-codex OAuth. Select an API billing profile for this authentication.',
          }),
    });
    checks.push({
      name: 'Native resources',
      status: 'pass',
      detail: `${pi.value.resources.skills.length} selected skills · project ${pi.value.resources.projectTrusted ? 'trusted' : 'untrusted; project skills and packages suppressed by Pi'} · saved trust unchanged`,
    });
  } else {
    checks.push({
      name: 'Native Pi',
      status: 'fail',
      detail: safeError(pi.reason),
      remedy:
        'Install Pi, authenticate it in your usual terminal session, and select the model you want to evaluate. Existing settings are preserved.',
    });
  }
  if (grader.status === 'fulfilled') {
    checks.push({
      name: 'API grader',
      status: grader.value ? 'pass' : 'skipped',
      detail: grader.value
        ? `${profile.grader.model} available; no generation sent`
        : 'Semantic grading disabled · no API key needed',
    });
  } else {
    checks.push({
      name: 'API grader',
      status: 'fail',
      detail: safeError(grader.reason),
      remedy: `Put OPENAI_API_KEY in ${keyFile}, or omit --semantic.`,
    });
  }
  const directory = path.join(repo, 'evals/runs', `doctor-${timestampId()}`);
  const store = new FileRunStore(directory, [key]);
  await store.initialize();
  await store.save('inspection.json', {
    checks,
    runtime: runtime.status === 'fulfilled' ? runtime.value : null,
    pi: pi.status === 'fulfilled' ? pi.value : null,
    grader: grader.status === 'fulfilled' ? grader.value : null,
    graderKeyFile: useGrader ? keyFile : null,
    agentSource: source,
    productionHooks: 'Production-linked startup hooks are excluded from evaluation trials.',
  });
  const ready = checks.every((check) => check.status !== 'fail');
  const remedies = checks
    .filter((check) => check.status === 'fail')
    .map((check) => `${check.name}: ${check.remedy}`)
    .join('\n');
  output.result(
    { ready, checks, report: path.join(directory, 'inspection.json') },
    `${ready ? 'Ready for an evaluation' : 'A few prerequisites need attention'}

${table(
  ['CHECK', 'STATUS', 'DETAIL'],
  checks.map((check) => [check.name, check.status.toUpperCase(), check.detail]),
)}
${
  remedies
    ? `
${remedies}
`
    : ''
}
No agent prompt or billed generation was sent.
Details: ${path.join(directory, 'inspection.json')}
${ready ? `Next: pnpm evals experiment repository-ui-copy${useGrader ? ' --semantic' : ''}` : 'Fix the failed checks, then run doctor again.'}`,
  );
  return ready ? 0 : 1;
}
