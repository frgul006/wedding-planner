# Agent evaluation package

A TypeScript library for recording coding-agent trials, preparing versioned evidence, and regrading saved recordings. The Wedding application imports none of this package.

[Usage, setup, limits, and authoring](../../evals/README.md) · [Architecture decision](../../docs/adr/0004-agent-evaluation-boundary.md)

## Architecture and exports

Domain contracts and application orchestration depend on the `Runner`, `Judge`, and `Store` interfaces. Adapters own Pi execution, Jev calls, and filesystem persistence. Graders define checks; the Judge supplies model judgments. A code-only suite needs no Judge, and regrading needs no Runner.

| Entry point                                       | Responsibility                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `@wedding-planner/agent-evals`                    | `defineView`, `codeGrader`, `modelGrader`, `createEvaluator`, and portable contracts |
| `@wedding-planner/agent-evals/pi`                 | Native `piRunner` and isolated recording                                             |
| `@wedding-planner/agent-evals/jev`                | `jevJudge` using the official TypeSafe SDK                                           |
| `@wedding-planner/agent-evals/files`              | Append-only `fileStore`, request journals, and readable reports                      |
| `@wedding-planner/agent-evals/examples/diagnosis` | Repository diagnostic Views and Graders                                              |

Core imports do not load vendor SDKs, filesystem, or subprocess code. The application saves a trial before grading, prepares each shared View once, checks coverage, journals exact requests before dispatch, and appends results. Source references, versions, and content hashes connect every grade to the saved evidence.

| Change                                        | Location                                                                                                         |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Portable contracts and authoring helpers      | [domain/library.ts](src/domain/library.ts), [index.ts](src/index.ts)                                             |
| Run, grade, regrade, and budget orchestration | [application/evaluator.ts](src/application/evaluator.ts)                                                         |
| Canonical identity and immutable snapshots    | [application/serialization.ts](src/application/serialization.ts)                                                 |
| Diagnostic preparation and validation         | [examples/diagnosis.ts](src/examples/diagnosis.ts)                                                               |
| Native execution and recording conversion     | [adapters/pi-runner.ts](src/adapters/pi-runner.ts), [adapters/recorded-trial.ts](src/adapters/recorded-trial.ts) |
| Jev batching and provider validation          | [adapters/jev-judge.ts](src/adapters/jev-judge.ts)                                                               |
| Persistent records and reports                | [adapters/library-file-store.ts](src/adapters/library-file-store.ts)                                             |
| Local isolation and independent acceptance    | [adapters/isolation](src/adapters/isolation)                                                                     |
| Runnable repository composition               | [cli/library-command.ts](src/cli/library-command.ts)                                                             |

## Development checks

From the repository root:

```bash
pnpm test:evals
pnpm check:evals
```

These checks run offline. Tests cover evidence preparation, provenance, ordering, missing observations, adversarial false passes, shared-state batching, errors, budgets, and append-only regrading. Native sandbox tests skip where macOS `sandbox-exec` is unavailable.

Explicit local probes are separate from ordinary tests:

```bash
pnpm --dir tools/agent-evals exec tsx test/repository-native-smoke.ts
pnpm --dir tools/agent-evals exec tsx test/playwright-package-native-smoke.ts
```

They exercise native tools without an agent prompt or grader generation and may refresh native authentication during preparation. The repository probe exercises the four native tools, denies access to private controls and dependency writes, checks the defective and repaired login flow, and verifies cleanup. The package probe checks installed Playwright launch while the unrelated browser cache stays inaccessible.

The optional Jev probe sends a small two-question batch and regrades a revised question against an authored fixture:

```bash
pnpm --dir tools/agent-evals exec tsx test/jev-live-smoke.ts --live
```

Without `--live`, it makes no requests. The live probe uses at most a $0.01 aggregate reservation allowance and saves private reports under `evals/runs/library-jev-smoke`. It runs no agent or browser and does not establish semantic calibration.
