import assert from 'node:assert/strict';
import test from 'node:test';
import { availableSkills, discoveredSkills } from '../src/application/skill-inventory.ts';
import { runTrial } from '../src/application/run-trial.ts';
import { observeSkills } from '../src/domain/deterministic-graders.ts';
import type { AgentResult, Task } from '../src/domain/types.ts';

const resources = [
  {
    path: '/trial/workspace/.agents/skills/caveman/SKILL.md',
    sha256: 'project-hash',
    kind: 'skill',
  },
  { path: '/trial/control/pi/skills/caveman/SKILL.md', sha256: 'global-hash', kind: 'skill' },
  { path: '/trial/workspace/AGENTS.md', sha256: 'instruction-hash', kind: 'instruction' },
];
const skills = [{ name: 'caveman', path: resources[0].path }];

test('file availability is separate from native discovery and duplicate skill suppression', () => {
  const available = availableSkills({ resources });
  assert.equal(available.length, 2);
  assert.ok(available.every((skill) => skill.available && skill.discovered === 'unknown'));
  const discovered = discoveredSkills(available, skills);
  assert.deepEqual(
    discovered.map((skill) => ({
      path: skill.path,
      discovered: skill.discovered,
      sha256: skill.sha256,
    })),
    [
      { path: resources[0].path, discovered: true, sha256: 'project-hash' },
      { path: resources[1].path, discovered: false, sha256: 'global-hash' },
    ],
  );
});

test('application records adapter-discovered skills without decoding a provider protocol', async () => {
  const task: Task = {
    id: 'docs',
    version: '1',
    kind: 'docs',
    targetFile: 'README.md',
    prompt: 'Update docs',
    expectedText: 'Hello',
    flowPath: '/',
  };
  const agent: AgentResult = {
    status: 'completed',
    startedAt: '',
    endedAt: '',
    exitCode: 0,
    signal: null,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      estimatedCostUsd: 0,
      costSource: 'test',
    },
    model: null,
    thinkingLevel: null,
    events: [],
  };
  const result = await runTrial(
    {
      id: 'inventory',
      task,
      variant: 'enabled',
      runtimeMs: 10,
      maxTokens: 100,
      maxEstimatedCostUsd: 1,
      executable: '/verified/pi',
      expectedModel: { provider: 'test', id: 'test', thinkingLevel: 'low' },
      manifest: {},
    },
    {
      environment: {
        async prepare() {
          return {
            root: '/trial',
            workspace: '/trial/workspace',
            url: 'http://127.0.0.1:1234',
            env: {},
            agentArgs: [],
            provenance: { resources },
            async collectArtifacts() {
              return [];
            },
            async cleanup() {},
          };
        },
      },
      agent: {
        async run(request) {
          assert.equal(request.executable, '/verified/pi');
          request.onEvent?.({
            id: 'discovery',
            sequence: 1,
            timestamp: '2026-09-07T12:00:00Z',
            actor: 'evaluator',
            kind: 'lifecycle',
            data: {},
            observation: { type: 'skills_discovered', skills },
          });
          return agent;
        },
      },
      graders: [],
      store: { async save() {}, append() {} },
    },
  );
  const inventories = result.evidence.events.filter(
    (event) => event.data.type === 'skill_inventory',
  );
  assert.equal(inventories.length, 2);
  assert.equal(inventories[0].actor, 'environment');
  assert.equal(inventories[1].actor, 'evaluator');
  const discovery = result.evidence.events.find(
    (event) => event.observation?.type === 'skills_discovered',
  );
  assert.deepEqual(inventories[1].data.derivedFrom, [discovery?.id]);
  const observed = observeSkills(result.evidence);
  assert.equal(observed[0].available, 'yes');
  assert.equal(observed[0].discovered, 'yes');
  assert.equal(observed[0].loaded, 'unknown');
  assert.equal(observed[1].available, 'yes');
  assert.equal(observed[1].discovered, 'no');
  assert.equal(observed[1].loaded, 'unknown');
});
