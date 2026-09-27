# agent-evals

Record an agent task once, inspect the evidence submitted to each grader, and revise grading against the same immutable recording. Consumers own tasks, evidence selection, questions, rubrics, and execution environments.

Requires Node 24. The package includes compiled JavaScript, TypeScript declarations, and the `agent-evals` executable. This repository builds it with `pnpm build:evals`; `npm pack` in this directory builds a distributable tarball.

| Import              | Responsibility                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| `agent-evals`       | Runner, View, Grader, Judge, Store contracts; evaluator; grading helpers; trial limits and evidence hashes |
| `agent-evals/pi`    | Native Pi execution, recording, normalization, and resource/configuration helpers                          |
| `agent-evals/jev`   | Jev categorical judgments through the TypeSafe SDK                                                         |
| `agent-evals/files` | Append-only local records, request journals, and readable reports                                          |

Core imports do not load Pi, Jev, the CLI, or consumer configuration. Adapters depend on core; the package never imports this repository's application or `evals/` files. Pi and Playwright executables are not bundled.

## Compose a consumer

Write ordinary TypeScript and export an `EvalConfig`. A View prepares named evidence items; a Grader describes how to assess them. There is no registry or config wrapper. Arrow callbacks and ordinary methods are both supported: the evaluator captures each callback before asynchronous work and preserves its original receiver, including class instance fields.

```ts
import { modelGrader, type EvalConfig, type View } from 'agent-evals';
import { jevJudge } from 'agent-evals/jev';
import { task, runner, prepareEvidence, readPrivateKey } from './my-evaluation.ts';

const evidence = { id: 'diagnosis', version: 1, prepare: prepareEvidence } satisfies View;
const hypothesis = modelGrader({
  id: 'hypothesis',
  version: 1,
  view: evidence,
  question: 'Does the visible hypothesis make a refutable prediction before the probe?',
  rubric: {
    pass: 'A stated prediction has an observable outcome that could disprove it.',
    fail: 'The complete evidence shows no such prediction before the probe.',
    unknown: 'The evidence cannot establish this.',
  },
});

export default {
  suite: { id: 'my-suite', tasks: [task], graders: [hypothesis] },
  createRunner: ({ recordingsDirectory }) => runner(recordingsDirectory),
  createJudge: async () => jevJudge({ apiKey: await readPrivateKey() }),
  budgetUsd: 0.01,
} satisfies EvalConfig;
```

The example imports are consumer implementations. In a checkout of this repository, see Wedding's `evals/config.ts` for a complete composition with tasks, Views, graders, and a Pi environment.

```bash
agent-evals run --config ./evals/config.ts --dry-run
agent-evals run --config ./evals/config.ts
agent-evals show RUN_ID
agent-evals regrade RUN_ID --config ./evals/config.ts
```

The default store is `.agent-evals` under the invocation directory; `--store PATH` selects another. TypeScript config loading is included in the executable. Config files are trusted executable code: dry-run loads the module but invokes no factories. Put credentials and setup inside the lazy factories. `show` reads only the store; `regrade` never creates a runner; `--code-only` skips model graders and the judge factory. Run `agent-evals --help` for limits, repetitions, budgets, and output options.

For programmatic use, `createEvaluator({ runner?, judge?, store, budgetUsd? })` exposes `run(suite, { repetitions?, limits?, signal? })`, `grade(trialId, { graders, signal? })`, and `regrade(runId, { graders, signal? })`. Regrading needs no Runner, and code graders need no Judge. Implement the small interfaces to replace an adapter.

## Pi environments and limits

`piRunner` requires `agentSource`, `recordingsDirectory`, explicit `billing`, and a `prepareEnvironment` callback. Optional `model`, `endpoint`, and `limits` control native execution. The callback receives the portable task, trial ID, cancellation signal, resolved limits, and inspected Pi configuration. It returns a workspace, environment variables, arguments, historical contexts, provenance, artifacts, final observations, and cleanup. Isolation policy and independent task acceptance belong to that callback; the adapter does not provide a default sandbox. Put captured contexts and capture gaps in `provenance.recordedContexts` and `provenance.contextCaptureGaps`. Explicit empty arrays mean discovery completed with no external instruction or skill content; missing or malformed capture remains incomplete.

Defaults are **30 minutes, 100 completed turns, and 1,000,000 weighted tokens per trial**. Limits resolve field by field: shared defaults, runner limits, task limits, then explicit per-trial overrides. Any reached limit stops the trial. Weighted usage is `input + output + 0.1 × (cacheRead + cacheWrite)`; raw provider usage is retained. Runtime covers agent startup/execution, excluding environment preparation, final acceptance, and grading. A completed turn includes the assistant response and its tool results. Usage can overshoot while a response is in flight. The first stop cause remains authoritative.

## Evidence and grading

Trials retain observable events, native source payloads, historical context, artifacts, outcomes, and capture gaps. Views declare scope, source references, omissions, applicability, and coverage. Grading records retain exact prepared evidence and versions, hashes, questions, requests, responses, errors, and usage. The filesystem store refuses overwrites; regrading appends records without changing the trial or earlier grades.

The evaluator journals credential-free request bodies through the Store before dispatch. The Jev adapter batches only identical submitted evidence envelopes. It uses categorical answers with explicit criteria, without invented explanations or citations. Oversized evidence fails preparation rather than being silently truncated. Budget estimates limit admission, not provider billing. Consumers load credentials explicitly.

Execution status, grader errors, and behavioral verdicts are separate. Missing evidence can produce `unknown`; it does not prove failure. Reports retain considered references separately from explicitly supporting references. A successful recording or transport check does not establish judge accuracy.

## Development

`src/core` contains portable contracts and evaluation rules, with grading rules in `src/core/grading`. Pi setup, runtime, and evidence live in `src/adapters/pi/setup`, `runtime`, and `evidence`; adapter directories expose their public entry points. `src/cli` loads consumer config and composes those contracts. Tests are grouped by core, CLI, Jev, files, Pi, and adapter behavior. The shared evaluator fixture lives in `test/fixtures`; the packaged CLI test installs a tarball in an unrelated directory, and Pi tests use a second, non-Wedding environment.

```bash
pnpm build
pnpm check
pnpm test
```

Tests are offline and make no paid model calls. Wedding-specific probes, grading tests, and environment limitations live in the source repository’s `evals/` directory, outside the distributed package.
