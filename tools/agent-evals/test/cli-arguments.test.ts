import assert from 'node:assert/strict';
import test from 'node:test';
import { helpText, parseCommand } from '../src/cli/arguments.ts';

test('task names are data and the original smoke invocation remains supported', () => {
  const current = parseCommand(['run', 'another-task', '--no-grader', '--json']);
  assert.equal(current.command, 'run');
  assert.deepEqual(current.args, ['another-task']);
  assert.equal(current.values['no-grader'], true);
  assert.equal(current.values.json, true);
  const alias = parseCommand(['smoke', '--task', 'ui-copy']);
  assert.equal(alias.command, 'run');
  assert.equal(alias.values.task, 'ui-copy');
  assert.throws(() => parseCommand(['run', 'ui-copy', '--task', 'docs-only']), /either/);
});

test('command-specific flags reject accidental paid or irrelevant options', () => {
  for (const argv of [
    ['tasks', '--semantic'],
    ['runs', '--budget-usd', '.01'],
    ['show', '--no-grader'],
  ]) {
    assert.throws(() => parseCommand(argv), /does not apply/);
  }
  assert.throws(() => parseCommand(['run', '--typo']), /Unknown option/);
  assert.throws(
    () => parseCommand(['regrade', 'latest', '--budget-usd', '.01']),
    /require --semantic/,
  );
  assert.equal(
    parseCommand(['regrade', 'latest', '--semantic', '--budget-usd', '.01']).values.semantic,
    true,
  );
});

test('invalid positional counts, variants and list limits fail before work starts', () => {
  for (const argv of [
    ['tasks', 'extra'],
    ['run', 'first', 'second'],
    ['compare', 'only-one'],
    ['compare', 'a', 'b', 'c'],
  ]) {
    assert.throws(() => parseCommand(argv), /arguments|needs two/);
  }
  assert.throws(() => parseCommand(['run', '--variant', 'maybe']), /enabled or disabled/);
  for (const limit of ['0', '1001', '1.5', 'NaN', '-1'])
    assert.throws(() => parseCommand(['runs', `--limit=${limit}`]), /whole number/);
  assert.equal(parseCommand(['runs', '--limit', '25']).values.limit, '25');
});

test('help is available without loading configuration or credentials', () => {
  assert.equal(parseCommand([]).command, 'help');
  assert.equal(parseCommand(['run', '--help']).helpTopic, 'run');
  assert.equal(parseCommand(['help', 'smoke']).helpTopic, 'run');
  assert.match(helpText('run'), /--dry-run/);
  assert.match(helpText('regrade'), /offline deterministic/);
  assert.throws(() => parseCommand(['help', 'missing']), /help <command>/);
});

test('unknown names, including inherited Object properties, are not commands', () => {
  for (const name of ['missing', 'toString', '__proto__']) {
    assert.throws(() => parseCommand([name]), /Unknown command/);
  }
});
