import assert from 'node:assert/strict';
import test from 'node:test';
import { piModelArguments, selectPiModel } from '../../src/adapters/pi/setup/pi-model-selection.ts';

const defaults = Object.freeze({
  provider: 'openai-codex',
  model: 'gpt-6-astra',
  thinkingLevel: 'xhigh',
});
const inspection = {
  defaults,
  rpc: {
    availableModels: [
      { provider: 'openai-codex', id: 'gpt-6-astra', reasoning: true },
      { provider: 'openai-codex', id: 'gpt-6-luna', reasoning: true },
    ],
  },
};

test('the profile selects Luna without changing native provider, reasoning or saved defaults', () => {
  const selection = selectPiModel(inspection, { model: 'gpt-6-luna' });
  assert.deepEqual(selection, { ...defaults, model: 'gpt-6-luna' });
  assert.equal(inspection.defaults.model, 'gpt-6-astra');
  assert.deepEqual(piModelArguments(selection), [
    '--provider',
    'openai-codex',
    '--model',
    'gpt-6-luna',
    '--thinking',
    'xhigh',
  ]);
});

test('omitting the model override retains native selection', () => {
  assert.deepEqual(selectPiModel(inspection, {}), defaults);
});

test('an unavailable model cannot silently fall back or change the authenticated provider', () => {
  for (const availableModels of [
    [],
    [{ provider: 'openai-codex', id: 'gpt-6-astra' }],
    [{ provider: 'openai', id: 'gpt-6-luna' }],
    [null],
  ]) {
    assert.throws(
      () => selectPiModel({ defaults, rpc: { availableModels } }, { model: 'gpt-6-luna' }),
      /openai-codex\/gpt-6-luna is unavailable.*No fallback model was selected/,
    );
  }
});

test('model overrides reject blank values', () => {
  assert.throws(() => selectPiModel(inspection, { model: ' ' }));
});
