# Agent Evaluation package

The primary workflow is to record one agent trial, inspect exactly what each grader sees, and revise graders against that saved evidence. The portable TypeScript API separates runners, versioned views, code/model graders, judges and storage. The Wedding application imports none of this package; domain/application code does not import Pi, a model SDK, filesystem or subprocess code.

[Repository workflows](../../evals/README.md) · [Authoring guide](../../evals/authoring.md) · [Diagnostic example](src/examples/diagnosis.ts)

## Start with the library workflow

```bash
pnpm evals library run --dry-run
pnpm evals library run
pnpm evals library show RUN_ID
pnpm evals library regrade RUN_ID --revision 2
```

`run` creates one bounded native Luna trial of the repository login-retry task, saves the recording, and applies two diagnostic Jev questions plus a deterministic validation-order check. `show` reads local results without model calls. `regrade` sharpens a question and appends new results without running Pi. Use `--no-judge` for deterministic grading only. The default library store is `evals/runs/library`; `--help` describes limits and options.

The CLI reads only `TYPESAFE_API_KEY` from this worktree's `.env.local` for Jev. Pi preserves its existing subscription authentication and reasoning. Included profiles select `gpt-6-luna` without changing global Pi settings; reports distinguish saved defaults from the evaluated model. Application credentials do not enter the isolated agent environment.

The API is available independently of this example CLI:

| Export                                            | Responsibility                                                                      |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `@wedding-planner/agent-evals`                    | `defineView`, `codeGrader`, `modelGrader`, `createEvaluator` and portable contracts |
| `@wedding-planner/agent-evals/pi`                 | Native `piRunner` using the existing execution infrastructure                       |
| `@wedding-planner/agent-evals/jev`                | `jevJudge` using the official SDK and pinned `jev-1.13.0`                           |
| `@wedding-planner/agent-evals/files`              | Append-only `fileStore` and Markdown inspection reports                             |
| `@wedding-planner/agent-evals/examples/diagnosis` | Shared diagnostic views and example graders                                         |

`createEvaluator({ store, runner, judge, budgetUsd })` provides `run(suite)`, `grade(trialId, { graders })` and `regrade(runId, { graders })`. A runner is needed only for new trials; a judge is needed only for model graders. Custom graders compose directly in TypeScript without joining the legacy central registry.

## Evidence and grading lifecycle

1. Run the task and save its immutable recording before grading. Preserve failures, actor attribution, captured context, tool results, artifacts and independent acceptance.
2. Prepare each shared, versioned view once. Each item declares its data, scope, source references, omissions, applicability and coverage gaps. Save the exact prepared evidence and its content hash.
3. Apply deterministic checks locally. Incomplete required evidence yields `unknown`; a required behavior absent from a complete recording can yield `fail`. Explicitly inapplicable items remain `not_applicable`.
4. Prepare model requests and admit their aggregate cost estimate. Jev batches questions over identical submitted evidence envelopes, including scope and source references. Oversize inputs are rejected without truncation.
5. Journal the exact credential-free provider body and question/version mapping before dispatch. Retain categorical answers, probabilities, confidence, resolved model and usage. Jev uses bounded timeouts, cancellation and no automatic retries.
6. Append a grading record and report containing the evidence, questions, request/response history, verdicts and execution errors. Regrading creates another record and preserves the original trial and every earlier grading.

The `diagnosis` view supports the falsifiable-hypothesis and relevant-probe questions. The separate `validationHistory` view checks whether required agent validation followed the final observed edit and matched the final target revision. Parser hints and agent claims alone do not prove behavior. Evaluator-owned acceptance cannot establish that the agent ran a check.

Considered sources are recorded separately from explicit supporting references. Jev supplies categorical judgments and probabilities; it does not generate supporting quotations or explanations. Reports keep that distinction visible. Diagnostic episode counts describe items within one trial, not independent agent attempts.

## Where to change something

| Responsibility                                      | Module                                                               |
| --------------------------------------------------- | -------------------------------------------------------------------- |
| Portable authoring contracts                        | `src/domain/library.ts`, `src/index.ts`                              |
| Preparation, grading, budgets and regrading         | `src/application/evaluator.ts`                                       |
| Canonical evidence identity and immutable snapshots | `src/application/serialization.ts`                                   |
| Diagnostic views and example graders                | `src/examples/diagnosis.ts`                                          |
| Jev batching, provider validation and bounds        | `src/adapters/jev-judge.ts`                                          |
| Trial/grade integrity, request journal and reports  | `src/adapters/library-file-store.ts`                                 |
| Pi runner and normalized saved recording            | `src/adapters/pi-runner.ts`, `recorded-trial.ts`                     |
| Native resources, transport and model selection     | `src/adapters/pi-harness.ts`, `pi-rpc.ts`, `pi-model-selection.ts`   |
| Isolated workspace, local services and acceptance   | `src/adapters/trial-environment.ts`, `isolation/`                    |
| Library example CLI                                 | `src/cli/library-command.ts`                                         |
| Compatible legacy grading and experiments           | `src/application/grade-evidence.ts`, `run-experiment.ts`             |
| Compatible legacy registry and saved-run storage    | `src/adapters/task-graders.ts`, `file-run-store.ts`, `saved-runs.ts` |
| Repository tasks, profiles and fixtures             | `../../evals/`                                                       |

The existing registry-based CLI and paired experiments remain supported. Their saved-run format and OpenAI rubric adapter continue to work; they are separate from the new library store and Jev grading path. `piRunner` reuses the established isolation, recording, cleanup and independent acceptance infrastructure, then exposes the retained recording through the portable trial contract.

Legacy `run` and `experiment` accept `--max-runtime-ms`, `--max-turns` and `--max-tokens`. Each trial resolves built-in defaults (one hour, 500 completed assistant turns, 5,000,000 weighted tokens), profile fields, task `limits`, then explicit flags. Input/output tokens count fully; cached reads/writes count at 10%. The effective profile reaches harness preparation before environment deadlines are set. Dry runs and `profiles` show the limits; raw provider usage is retained separately. See [task limit examples](../../evals/authoring.md#compare-configurations).

## Validation

```bash
pnpm check:evals
pnpm test:evals
```

Offline checks cover preparation sharing, evidence/version identity, exact request dispatch, response validation, actor attribution, budgets, cancellation, retained failures and append-only regrading. Native sandbox tests skip where macOS `sandbox-exec` is unavailable.

Explicit local probes remain separate from routine CI:

```bash
pnpm --dir tools/agent-evals exec tsx test/isolation-native-smoke.ts
pnpm --dir tools/agent-evals exec tsx test/repository-native-smoke.ts
pnpm --dir tools/agent-evals exec tsx test/playwright-package-native-smoke.ts
```

These probes exercise native tools without a Pi prompt or grader generation. They may refresh native authentication while preparing the environment. The repository probe checks a failing original condition and a passing repaired condition using the real app.

The opt-in Jev smoke sends two batched diagnostic questions, then regrades a revised question against the same **authored calibration fixture**:

```bash
pnpm --dir tools/agent-evals exec tsx test/jev-live-smoke.ts --live
```

Without `--live`, it makes no requests. With it, the combined reservation allowance is at most $0.01 and reports are saved under `evals/runs/library-jev-smoke`. It runs no native agent or browser and does not establish semantic calibration.

## Remaining scope

The real-app environment runs macOS/Next.js and the admin login UI with an unavailable local authentication endpoint. It does not prove database behavior, successful authentication or production integration. Optional native extension/subagent execution remains excluded by the isolated four-tool Pi adapter. Historical captures can contain gaps; current files must not be substituted for missing historical evidence.

The diagnostic questions and extraction views are examples requiring human calibration. Successful provider integration, one authored positive example or one repository trial does not establish grader accuracy, instruction effectiveness or population-level agent performance. Broader experiment matrices follow once the saved-evidence grading workflow is trusted.
