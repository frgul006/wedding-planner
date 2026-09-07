import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { renderReport } from '../src/domain/report.ts';
import type { EvidenceEvent, TrialEvidence } from '../src/domain/types.ts';

function evidence(events: EvidenceEvent[] = []): TrialEvidence {
  return {
    task: {
      id: 'docs',
      version: '1',
      kind: 'docs',
      prompt: 'Update local development notes',
      targetFile: 'README.md',
      expectedText: 'pnpm dev',
      flowPath: '/',
    },
    variant: 'enabled',
    localUrl: 'http://127.0.0.1:1234',
    artifacts: [],
    events,
    agent: {
      status: 'completed',
      startedAt: '',
      endedAt: '',
      exitCode: 0,
      signal: null,
      model: { provider: 'openai-codex', id: 'test' },
      thinkingLevel: 'xhigh',
      events: [],
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        estimatedCostUsd: 25,
        costSource: 'Catalog estimate, not billing',
      },
    },
  };
}

test('report requires evaluator-recorded controls rather than inferring subscription from provider', () => {
  const unverified = renderReport('historical', evidence(), []);
  assert.match(unverified, /Agent cost: \$25\.000000/);
  assert.doesNotMatch(
    unverified,
    /dollar threshold was disabled|configured Codex OAuth subscription/,
  );
  const marker: EvidenceEvent = {
    id: 'e1',
    sequence: 1,
    timestamp: '',
    actor: 'evaluator',
    kind: 'lifecycle',
    data: { type: 'pi_started', agentCostLimitEnabled: false },
  };
  const verifiedControls = renderReport('subscription', evidence([marker]), []);
  assert.match(verifiedControls, /dollar threshold was disabled/);
  assert.doesNotMatch(verifiedControls, /Agent cost: \$25/);
  assert.doesNotMatch(
    verifiedControls,
    /\$1 API admission|catalog estimates for Pi are not deductions/,
  );
  assert.match(verifiedControls, /manifest or regrade JSON records the API allowance/);
  const agentClaim = renderReport('claim', evidence([{ ...marker, actor: 'agent' }]), []);
  assert.doesNotMatch(agentClaim, /dollar threshold was disabled/);
});

test('semantic regrade respects a smaller CLI API allowance before generating', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eval-regrade-budget-test-'));
  try {
    const savedEvidence = JSON.stringify(evidence());
    const manifest = '{}';
    const grades = JSON.stringify([
      {
        grader: 'browser-compliance',
        version: '1',
        verdict: 'not-applicable',
        reason: 'The docs task does not require browser validation.',
        evidenceRefs: [],
      },
    ]);
    const hash = (text: string) => createHash('sha256').update(text).digest('hex');
    await writeFile(join(directory, 'evidence.json'), savedEvidence);
    await writeFile(join(directory, 'manifest.json'), manifest);
    await writeFile(join(directory, 'grades.json'), grades);
    await writeFile(
      join(directory, 'integrity.json'),
      JSON.stringify({
        files: {
          'evidence.json': hash(savedEvidence),
          'manifest.json': hash(manifest),
          'grades.json': hash(grades),
        },
      }),
    );
    const keyFile = join(directory, '.env.test');
    await writeFile(keyFile, 'OPENAI_API_KEY=not-a-real-api-key\n');
    const requests = join(directory, 'requests.jsonl');
    const preload = join(directory, 'fetch-stub.mjs');
    // Every fetch is stubbed, including model availability: this test has no live calls.
    await writeFile(
      preload,
      `import { appendFileSync } from 'node:fs';\nglobalThis.fetch = async input => {\n const url = typeof input === 'string' ? input : input.url;\n appendFileSync(${JSON.stringify(requests)}, JSON.stringify(url) + '\\n');\n if (url.includes('/v1/models/')) return new Response(JSON.stringify({ id: 'gpt-5.6-luna' }), { status: 200 });\n throw new Error('Generation must not be dispatched after budget rejection');\n};\n`,
    );
    const require = createRequire(import.meta.url);
    const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
    await assert.rejects(
      promisify(execFile)(
        process.execPath,
        [
          '--import',
          require.resolve('tsx'),
          '--import',
          preload,
          '--',
          cli,
          'regrade',
          directory,
          '--semantic',
          '--budget-usd',
          '0.000001',
          '--grader-env-file',
          keyFile,
        ],
        { cwd: dirname(cli), timeout: 15_000 },
      ),
      (error) => {
        assert.equal((error as { code?: number }).code, 1);
        assert.match(
          (error as { stderr: string }).stderr,
          /Estimated API budget exceeded before dispatch/,
        );
        return true;
      },
    );
    // Admission now precedes even the unbilled model-availability check.
    await assert.rejects(access(requests), { code: 'ENOENT' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
