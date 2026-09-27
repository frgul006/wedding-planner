import assert from 'node:assert/strict';
import test from 'node:test';
import {
  containsVerificationInvocation,
  parseBrowserSnapshotChain,
  verificationInvocationKinds,
} from '../src/examples/browser-command-chain.ts';

test('literal navigation and interactions retain argument order and end in one explicit snapshot', () => {
  assert.deepEqual(
    parseBrowserSnapshotChain(
      'playwright-cli open http://127.0.0.1:4321 && playwright-cli fill e12 "a person@example.test" && playwright-cli click e17 && sleep 0.25 && playwright-cli snapshot',
    ),
    {
      session: null,
      steps: [
        { command: 'playwright-cli', action: 'open', args: ['http://127.0.0.1:4321'] },
        { command: 'playwright-cli', action: 'fill', args: ['e12', 'a person@example.test'] },
        { command: 'playwright-cli', action: 'click', args: ['e17'] },
        { command: 'sleep', action: 'sleep', args: ['0.25'] },
        { command: 'playwright-cli', action: 'snapshot', args: [] },
      ],
    },
  );
  assert.equal(parseBrowserSnapshotChain('sleep 0&&playwright-cli snapshot')?.steps.length, 2);
  assert.equal(
    parseBrowserSnapshotChain('playwright-cli goto https://example.test&&playwright-cli snapshot')
      ?.steps.length,
    2,
  );
});

test('all session option forms agree across commands and are removed from action arguments', () => {
  const forms = ['-s=trial_2', '--session=trial_2', '-s trial_2', '--session "trial_2"'];
  for (const first of forms)
    for (const second of forms) {
      const parsed = parseBrowserSnapshotChain(
        `playwright-cli ${first} goto https://example.test && sleep 1 && playwright-cli ${second} snapshot`,
      );
      assert.equal(parsed?.session, 'trial_2');
      assert.deepEqual(parsed?.steps[0]?.args, ['https://example.test']);
    }
});

test('quoted literal values preserve spaces, operators, empty strings, quotes and Unicode', () => {
  for (const [literal, expected] of [
    ['"a && b"', 'a && b'],
    ["'a ; b | c > d # comment * ? [x] {y} ~ !'", 'a ; b | c > d # comment * ? [x] {y} ~ !'],
    ['"O\'Brien — hej"', "O'Brien — hej"],
    ['\'say "hello"\'', 'say "hello"'],
    ["''", ''],
    ['""', ''],
    ['-', '-'],
    ['prefix" and "suffix', 'prefix and suffix'],
  ]) {
    const parsed = parseBrowserSnapshotChain(
      `playwright-cli fill e1 ${literal} && playwright-cli snapshot`,
    );
    assert.equal(parsed?.steps[0]?.args[1], expected, literal);
  }
  assert.deepEqual(
    parseBrowserSnapshotChain(
      'playwright-cli goto "https://example.test/?first=1&&second=2#section" && playwright-cli snapshot',
    )?.steps[0]?.args,
    ['https://example.test/?first=1&&second=2#section'],
  );
});

test('sleep accepts finite nonnegative numeric seconds with no units or extra arguments', () => {
  for (const value of ['0', '1', '0.25', '.5', '1.', '+2', '1e-3', '2E2'])
    assert.ok(parseBrowserSnapshotChain(`sleep ${value} && playwright-cli snapshot`), value);
  for (const value of [
    '',
    '-1',
    '-0.1',
    'NaN',
    'Infinity',
    '1e309',
    '1s',
    '1ms',
    '1 2',
    '--help',
    '""',
  ])
    assert.equal(
      parseBrowserSnapshotChain(`sleep ${value} && playwright-cli snapshot`),
      undefined,
      value,
    );
});

test('unsupported shell grammar and executables never become browser evidence', () => {
  for (const command of [
    '',
    'playwright-cli snapshot',
    '&& playwright-cli snapshot',
    'playwright-cli click e1 &&',
    'playwright-cli click e1 && && playwright-cli snapshot',
    'playwright-cli click e1 &&& playwright-cli snapshot',
    'playwright-cli click e1; playwright-cli snapshot',
    'playwright-cli click e1 || playwright-cli snapshot',
    'playwright-cli click e1 | playwright-cli snapshot',
    'playwright-cli click e1 & playwright-cli snapshot',
    'playwright-cli click e1 && playwright-cli snapshot > fake.yml',
    'playwright-cli click e1 && playwright-cli snapshot 2>&1',
    'playwright-cli click e1 && playwright-cli snapshot < fake.yml',
    'playwright-cli click e1 && playwright-cli snapshot <<EOF',
    'playwright-cli click e1 && playwright-cli snapshot # fake',
    'echo playwright-cli && playwright-cli snapshot',
    'env playwright-cli click e1 && playwright-cli snapshot',
    'PATH=/fake playwright-cli click e1 && playwright-cli snapshot',
    'command playwright-cli click e1 && playwright-cli snapshot',
    '/tmp/playwright-cli click e1 && playwright-cli snapshot',
    'alias playwright-cli=fake && playwright-cli snapshot',
    'playwright-cli() { echo fake; } && playwright-cli snapshot',
    '(playwright-cli click e1) && playwright-cli snapshot',
    'playwright-cli goto $URL && playwright-cli snapshot',
    'playwright-cli fill e1 "$(touch /tmp/never)" && playwright-cli snapshot',
    "playwright-cli fill e1 '$HOME' && playwright-cli snapshot",
    'playwright-cli fill e1 `echo fake` && playwright-cli snapshot',
    'playwright-cli fill e1 "a\\b" && playwright-cli snapshot',
    'playwright-cli fill e1 * && playwright-cli snapshot',
    'playwright-cli fill e1 ? && playwright-cli snapshot',
    'playwright-cli fill e1 [ab] && playwright-cli snapshot',
    'playwright-cli fill e1 {a,b} && playwright-cli snapshot',
    'playwright-cli fill e1 ~/secret && playwright-cli snapshot',
    'playwright-cli fill e1 !history && playwright-cli snapshot',
    'playwright-cli fill e1 "unfinished && playwright-cli snapshot',
    "playwright-cli fill e1 'unfinished && playwright-cli snapshot",
  ])
    assert.equal(parseBrowserSnapshotChain(command), undefined, command);
  for (const character of ['\n', '\r', '\t', '\0', '\x1b', '\x7f', '\x85', '\u2028', '\u2029'])
    assert.equal(
      parseBrowserSnapshotChain(
        `playwright-cli fill e1 "a${character}b" && playwright-cli snapshot`,
      ),
      undefined,
    );
});

test('browser actions have exact arity, literal targets, consistent sessions and one final snapshot', () => {
  for (const command of [
    'playwright-cli snapshot && playwright-cli snapshot',
    'playwright-cli snapshot && sleep 1',
    'playwright-cli click e1 && sleep 1',
    'playwright-cli click e1 && playwright-cli snapshot && sleep 1',
    'playwright-cli click e1 && playwright-cli snapshot --filename=out.yml',
    'playwright-cli goto && playwright-cli snapshot',
    'playwright-cli open --help && playwright-cli snapshot',
    'playwright-cli goto file:///tmp/page && playwright-cli snapshot',
    'playwright-cli goto javascript:alert && playwright-cli snapshot',
    'playwright-cli goto https:// && playwright-cli snapshot',
    'playwright-cli goto https://example.test extra && playwright-cli snapshot',
    'playwright-cli --config=evil goto https://example.test && playwright-cli snapshot',
    'playwright-cli --headed open https://example.test && playwright-cli snapshot',
    'playwright-cli fill e1 && playwright-cli snapshot',
    'playwright-cli fill e1 value extra && playwright-cli snapshot',
    'playwright-cli fill e1 --help && playwright-cli snapshot',
    'playwright-cli fill e1 "--help" && playwright-cli snapshot',
    "playwright-cli fill e1 '--session=other' && playwright-cli snapshot",
    'playwright-cli fill e1 --config=evil && playwright-cli snapshot',
    'playwright-cli fill e1 --literal-value && playwright-cli snapshot',
    'playwright-cli fill e1 -v && playwright-cli snapshot',
    'playwright-cli fill e1 -1 && playwright-cli snapshot',
    'playwright-cli fill e1 -- && playwright-cli snapshot',
    'playwright-cli fill e1 -- --literal-value && playwright-cli snapshot',
    'playwright-cli fill #selector value && playwright-cli snapshot',
    'playwright-cli click button && playwright-cli snapshot',
    'playwright-cli click e1 e2 && playwright-cli snapshot',
    'playwright-cli click e1 --force && playwright-cli snapshot',
    'playwright-cli evaluate code && playwright-cli snapshot',
    'playwright-cli -s=one click e1 && playwright-cli -s=two snapshot',
    'playwright-cli -s=one click e1 && playwright-cli snapshot',
    'playwright-cli click e1 && playwright-cli -s=one snapshot',
    'playwright-cli -s= click e1 && playwright-cli snapshot',
    'playwright-cli --session=one=two click e1 && playwright-cli snapshot',
    'playwright-cli --session "two words" click e1 && playwright-cli snapshot',
    'playwright-cli --session --other click e1 && playwright-cli snapshot',
    'playwright-cli -s=one --session=one click e1 && playwright-cli -s=one snapshot',
    'playwright-cli click e1 -s=one && playwright-cli -s=one snapshot',
  ])
    assert.equal(parseBrowserSnapshotChain(command), undefined, command);
});

test('unsupported actual invocations remain candidates across chains and ordinary wrappers', () => {
  for (const command of [
    'cd /tmp && playwright-cli snapshot --unsupported',
    'env playwright-cli snapshot --unsupported',
    'env MODE=test command -- playwright-cli snapshot --unsupported',
    'env -u SECRET playwright-cli -s=trial snapshot',
    'PATH=/untrusted playwright-cli snapshot',
    'command -p playwright-cli snapshot',
    'exec playwright-cli snapshot',
    'nohup playwright-cli snapshot',
    'timeout 30s playwright-cli snapshot',
    'sleep 1 && playwright-cli snapshot --unsupported',
    'cd /tmp; playwright-cli snapshot > output.yml',
    'false || playwright-cli snapshot',
    '(playwright-cli snapshot)',
    'playwright-cli snapshot --config=$CONFIG',
    'playwright-cli goto "$URL" && playwright-cli snapshot',
    'cd /tmp && pnpm test --unsupported',
    'env MODE=test npm run lint',
    'npx vitest run',
    'jest --runInBand',
    'cd /tmp && pnpm exec playwright-cli snapshot',
    'env npx playwright-cli snapshot',
    'env bash -c "playwright-cli snapshot"',
    'echo "$(playwright-cli snapshot)"',
    'echo `playwright-cli snapshot`',
  ])
    assert.equal(containsVerificationInvocation(command), true, command);
});

test('quoted documentation, discovery, help and action values are not verification invocations', () => {
  for (const command of [
    'echo "playwright-cli snapshot"',
    'echo "cd /tmp && playwright-cli snapshot"',
    "printf '%s\\n' 'playwright-cli snapshot'",
    "printf '%s' 'pnpm test && playwright-cli snapshot'",
    'echo "Use $TOOL && playwright-cli snapshot"',
    'echo \\"playwright-cli snapshot\\"',
    'echo harmless # documentation; playwright-cli snapshot',
    'command -v playwright-cli',
    'command -v playwright-cli || true',
    'cat package.json; command -v playwright-cli || true; ls tools',
    'find . -name package.json; playwright-cli --help',
    'playwright-cli snapshot --help',
    'playwright-cli -s snapshot --help',
    'playwright-cli fill e1 snapshot',
    'playwright-cli fill e1 "pnpm test"',
    'playwright-cli open https://example.test/snapshot',
    'env echo "playwright-cli snapshot"',
    'command printf "playwright-cli snapshot"',
    "echo '$(playwright-cli snapshot)'",
    "echo '`playwright-cli snapshot`'",
    'echo "\\$(playwright-cli snapshot)"',
    'echo "\\`playwright-cli snapshot\\`"',
    'echo harmless # $(playwright-cli snapshot)',
  ])
    assert.equal(containsVerificationInvocation(command), false, command);
});

test('literal verification categories preserve assignment prefixes and union mixed checks', () => {
  for (const command of [
    'PLAYWRIGHT_BASE_URL=http://127.0.0.1:4321 pnpm exec playwright test retry.spec.ts',
    'env PLAYWRIGHT_BASE_URL=http://127.0.0.1:4321 pnpm exec playwright test retry.spec.ts',
    'command pnpm exec playwright test retry.spec.ts',
    'npx playwright test retry.spec.ts',
    'pnpm exec vitest run',
    'npm test',
  ])
    assert.deepEqual(verificationInvocationKinds(command), ['test'], command);
  assert.deepEqual(verificationInvocationKinds('pnpm lint && npm run build'), ['lint', 'build']);
  assert.deepEqual(verificationInvocationKinds('pnpm test && playwright-cli snapshot'), [
    'test',
    'browser_snapshot',
  ]);
  assert.deepEqual(verificationInvocationKinds('pnpm test && pnpm test'), ['test']);
  assert.deepEqual(
    verificationInvocationKinds('playwright-cli click e1 && sleep 1 && playwright-cli snapshot'),
    ['browser_snapshot'],
  );
  assert.deepEqual(verificationInvocationKinds('echo "pnpm test && playwright-cli snapshot"'), []);
});

test('ambiguous grammar or an arbitrary executable cannot be narrowed to one verification category', () => {
  for (const command of [
    'pnpm test; playwright-cli snapshot',
    'pnpm test && arbitrary-script',
    'pnpm test && env bash -c "playwright-cli snapshot"',
    'pnpm test && echo "$(playwright-cli snapshot)"',
    'PLAYWRIGHT_BASE_URL=$URL pnpm exec playwright test',
    'pnpm exec node arbitrary.js',
    'pnpm test && npx echo "arbitrary package"',
    'pnpm --filter app test',
    'playwright-cli run-code "arbitrary code"',
    'playwright-cli snapshot --config=custom.js',
    'pnpm test || pnpm build',
  ])
    assert.equal(verificationInvocationKinds(command), undefined, command);
});
