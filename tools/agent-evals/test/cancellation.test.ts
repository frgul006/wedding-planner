import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import { installCancellationHandlers } from '../src/cli/cancellation.ts';

for (const [signal, exitCode] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
] as const) {
  test(`${signal} requests cancellation and lets pending cleanup finish before exit ${exitCode}`, async () => {
    const moduleUrl = new URL('../src/cli/cancellation.ts', import.meta.url).href;
    const script = `
      import { installCancellationHandlers } from ${JSON.stringify(moduleUrl)};
      const cancellation = installCancellationHandlers(() => {
        process.stdout.write('cancelling\\n');
        setTimeout(() => {
          process.stdout.write('cleanup-and-evidence-saved\\n');
          process.exitCode = cancellation.exitCode;
          cancellation.dispose();
          clearInterval(keepAlive);
        }, 80);
      });
      const keepAlive = setInterval(() => {}, 1000);
      process.stdout.write('ready\\n');
    `;
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', script],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const closed = once(child, 'close');
    let output = '';
    let errors = '';
    const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (String(chunk).includes('ready')) child.kill(signal);
      // A second interrupt must not bypass the in-progress cleanup.
      if (String(chunk).includes('cancelling')) child.kill(signal);
    });
    child.stderr.on('data', (chunk) => {
      errors += chunk;
    });
    try {
      assert.deepEqual(await closed, [exitCode, null], errors);
      assert.equal(output, 'ready\ncancelling\ncleanup-and-evidence-saved\n');
    } finally {
      clearTimeout(timeout);
      child.kill('SIGKILL');
    }
  });
}

test('disposing cancellation handlers restores prior signal listeners', () => {
  const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
  const cancellation = installCancellationHandlers();
  assert.equal(cancellation.exitCode, undefined);
  assert.equal(cancellation.signal.aborted, false);
  cancellation.dispose();
  cancellation.dispose();
  assert.deepEqual([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')], before);
});
