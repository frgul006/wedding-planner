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

test('explicit regrade grader selection is syntactically bounded and command-specific', () => {
  assert.equal(
    parseCommand(['regrade', 'latest', '--graders', 'target-outcome,diff-scope']).values.graders,
    'target-outcome,diff-scope',
  );
  for (const selection of ['', 'target-outcome,', 'target-outcome,target-outcome', '../private'])
    assert.throws(
      () => parseCommand(['regrade', 'latest', '--graders', selection]),
      /unique grader IDs/,
    );
  assert.throws(() => parseCommand(['run', '--graders', 'target-outcome']), /does not apply/);
  assert.match(helpText('regrade'), /--graders id,id/);
});

test('unknown names, including inherited Object properties, are not commands', () => {
  for (const name of ['missing', 'toString', '__proto__']) {
    assert.throws(() => parseCommand([name]), /Unknown command/);
  }
});

test('experiment flags describe a bounded whole experiment and reject conflicting grader modes', () => {
  const request = parseCommand([
    'experiment',
    'repository-ui-copy',
    '--pairs',
    '3',
    '--semantic',
    '--agent-source',
    '/checkout',
  ]);
  assert.equal(request.command, 'experiment');
  assert.equal(request.values.pairs, '3');
  assert.equal(request.values['agent-source'], '/checkout');
  for (const pairs of ['0', '11', '1.5'])
    assert.throws(() => parseCommand(['experiment', '--pairs', pairs]), /between 1 and 10/);
  assert.throws(() => parseCommand(['experiment', '--semantic', '--no-grader']), /not both/);
  assert.throws(() => parseCommand(['experiment', '--variant', 'enabled']), /does not apply/);
  assert.equal(parseCommand(['compare', 'a', 'b', '--factor', 'model']).values.factor, 'model');
  assert.throws(() => parseCommand(['compare', 'a', 'b', '--factor', 'anything']), /--factor/);
  assert.match(helpText('experiment'), /entire experiment/);
});
