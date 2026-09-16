# Agent Evaluation package

The evaluator prepares a task environment, runs an agent, records what happened, and grades the saved evidence. The Wedding application imports none of this package. Domain/application code does not import Pi, AI SDK, filesystem or subprocess code.

[Run an experiment](../../evals/README.md) · [Add a task, grader or harness](../../evals/authoring.md)

## Where to change something

| Responsibility                                               | Module                                                               |
| ------------------------------------------------------------ | -------------------------------------------------------------------- |
| Tasks, evidence, grades and runtime contracts                | `src/domain/types.ts`                                                |
| Observable browser/skill behavior                            | `src/domain/deterministic-graders.ts`                                |
| Independent acceptance and change scope                      | `src/domain/acceptance-graders.ts`                                   |
| Fixed conditions and declared experiment factors             | `src/domain/comparison.ts`                                           |
| A trial's lifecycle, evidence and cleanup                    | `src/application/run-trial.ts`                                       |
| Shared live/regrade judgment operation                       | `src/application/grade-evidence.ts`                                  |
| Paired scheduling, retained attempts and aggregate admission | `src/application/run-experiment.ts`                                  |
| Task-selected graders                                        | `src/adapters/task-graders.ts`                                       |
| Harness selection and native Pi composition                  | `src/adapters/harnesses.ts`, `pi-harness.ts`                         |
| Native Pi transport and normalized observations              | `src/adapters/pi-rpc.ts`, `pi-evidence.ts`, `playwright-evidence.ts` |
| Workspace, processes, local services and final checks        | `src/adapters/trial-environment.ts`, `isolation/`                    |
| Direct OpenAI rubric generation                              | `src/adapters/ai-sdk-grader.ts`                                      |
| Saved evidence, integrity and regrading history              | `src/adapters/file-run-store.ts`, `saved-runs.ts`                    |
| Allowlisted public review summaries                          | `src/adapters/review-bundle.ts`                                      |
| CLI parsing, previews and presentation                       | `src/cli/`                                                           |
| Repository tasks, profiles and rubrics                       | `../../evals/`                                                       |

The harness registry owns external wiring. An adapter supplies an `AgentRunner` and `TrialEnvironment`; trial and experiment execution do not need to know how that agent authenticates or launches. Diagnostics and profile-specific configuration still need an implementation for each backend. The environment encapsulates process shutdown, trusted acceptance and artifact capture. Graders use those saved observations; they never reach into a live workspace.

## Lifecycle

1. Validate task/profile/registry entries and admit the aggregate API reservation.
2. Inspect and freeze the selected harness configuration once per experiment.
3. Prepare an isolated checkout, native resources, local services and private authentication.
4. Run the agent. Normalize streamed or returned events into one attributed transcript.
5. Stop agent descendants, independently check the final application and capture its changes.
6. Unconditionally clean up processes and private credentials, retaining failures and evidence.
7. Save evidence before grading; run selected graders through `gradeEvidence`; save rich grader status, usage, metadata and judgments.
8. Seal recordings and produce reports. A paired experiment retains all attempts and compares fixed conditions.

`regrade` starts at step 7 with verified saved evidence. Both paths use the same registry and application operation. Each regrade appends a revision; original results remain intact. A grading failure cannot erase a completed paid trial.

## Contracts that matter

- Agent, environment and evaluator are different actors. Evaluator browser checks cannot prove agent compliance.
- A runner can stream events, return its complete event list, or do both. The application retains events once and assigns recording IDs.
- Execution status is separate from verdicts. A completed run can fail; an interrupted run can have useful artifacts.
- A grader returns versioned judgments plus execution status and optional usage/metadata. Exceptions become retained unknown judgments.
- Native model/auth selection is preserved; optional extension tools remain excluded by this isolated Pi adapter. Reports expose that difference.
- Subscription usage has runtime/token bounds; direct grader API spending has its own aggregate reservation.
- Comparisons declare the varying factor. Model/configuration changes cannot silently enter an instruction comparison.

## Validation

```bash
pnpm check:evals
pnpm test:evals
```

These offline checks run in CI. Tests cover transport/failure behavior, live/regrade equivalence, actor attribution, genuine and false browser evidence, task/harness registration, comparison eligibility and retained attempts. Tests requiring macOS sandbox-exec skip on other platforms.

Explicit local probes are separate:

```bash
pnpm --dir tools/agent-evals exec tsx test/isolation-native-smoke.ts
pnpm --dir tools/agent-evals exec tsx test/repository-native-smoke.ts
pnpm --dir tools/agent-evals exec tsx test/playwright-package-native-smoke.ts
```

They exercise native tools without a Pi prompt or grader generation. They may refresh native authentication while preparing the environment. The repository probe demonstrates a failing original condition and a passing repaired condition using the real app. Live trials use the public CLI and remain outside routine CI.

## Remaining scope

The current real-app environment runs macOS/Next.js and the admin login UI with an unavailable local authentication endpoint. It does not prove database behavior, successful authentication or production integration. Full native extension/subagent execution needs an environment adapter that can enforce isolation and usage accounting for that complete process tree. Semantic human calibration and reliable population estimates remain research work, not properties established by one pair.
