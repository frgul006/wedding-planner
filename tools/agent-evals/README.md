# Agent Evaluation package

This TypeScript workspace package runs and judges coding-agent trials. It is independent of the Wedding application: Next.js imports no evaluation code, and evaluation domain/application code imports no Pi, AI SDK, filesystem or subprocess implementation.

[Use the CLI](../../evals/README.md) · [Add tasks and adapters](../../evals/authoring.md) · [Boundary decision](../../docs/adr/0004-agent-evaluation-boundary.md)

## Find the right place to change

| Location                                                             | Owns                                                                                         |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/domain/types.ts`                                                | Tasks, attributed evidence/observations, grades, usage and ports                             |
| `src/domain/deterministic-graders.ts`                                | Pure mechanical outcome, browser and skill judgments                                         |
| `src/domain/comparison.ts`                                           | Controlled-pair eligibility and structural mismatch explanations                             |
| `src/domain/report.ts`                                               | Readable trial/regrade/comparison reports                                                    |
| `src/domain/budget.ts`                                               | Estimated cost admission                                                                     |
| `src/application/run-trial.ts`                                       | One trial’s lifecycle, attribution, cleanup, persistence and deterministic grading           |
| `src/application/skill-inventory.ts`                                 | Distinguishing prepared files from actual discovery                                          |
| `src/adapters/pi-rpc.ts`, `pi-evidence.ts`, `playwright-evidence.ts` | Native Pi transport and translation of tool receipts/browser output into domain observations |
| `src/adapters/pi-inspection.ts`                                      | Installed Pi configuration and native resource inspection                                    |
| `src/adapters/trial-environment.ts`, `isolation/`                    | Synthetic workspace/services, tool restrictions, credential preparation and cleanup          |
| `src/adapters/ai-sdk-grader.ts`                                      | Direct OpenAI structured output, usage and verified citations                                |
| `src/adapters/file-run-store.ts`, `saved-runs.ts`                    | Redaction, evidence integrity, retained runs and grading revisions                           |
| `src/adapters/evaluation-config.ts`                                  | Task/profile discovery, schemas and source hashes                                            |
| `src/adapters/trial-manifest.ts`                                     | Frozen execution conditions, source hashes and comparison eligibility                        |
| `src/cli/arguments.ts`, `live-plan.ts`                               | Command validation and preview/admission before external work                                |
| `src/cli/commands/`                                                  | Adapter composition for each CLI workflow                                                    |
| `src/cli/presenters/saved-run.ts`, `output.ts`                       | Human/JSON views of the selected grading revision and usage                                  |
| `src/cli/cancellation.ts`                                            | Signal handling that lets cleanup and evidence writes finish                                 |
| `../../evals/`                                                       | Repository-specific tasks, fixtures, rubrics, profiles and calibration material              |

Dependencies point inward. Domain functions work with plain data. Application code calls ports. Adapters implement external behavior. The CLI selects inputs, composes those adapters and presents results. Changes to a task should normally require JSON/Markdown edits, while a different runtime belongs in an adapter.

## Follow a trial

1. The CLI validates the task, profile and API allowance before external work. A dry run stops after previewing this configuration.
2. Native inspection freezes Pi’s configured model/reasoning and resource provenance. The environment prepares a synthetic Git checkout, local server and sandboxed tools.
3. Native credential refresh uses the original Pi store’s locking. Only the selected provider is copied privately, with validity covering the bounded trial. Settings/model selection stay unchanged.
4. `runTrial` asks `AgentRunner` to run. The Pi adapter waits for `agent_settled`, normalizes native events and retains raw messages for audit. The application assigns one ordered transcript with agent/environment/evaluator attribution.
5. Cleanup stops tool descendants before final artifacts are observed, and removes private authentication copies. Execution failures and cleanup failures remain visible independently of known outcomes.
6. The application persists evidence before deterministic grading. The CLI optionally adds the bounded semantic judgment, writes the final report and seals the saved files.

Reading/regrading saved evidence does not rerun Pi. The filesystem adapter verifies seals and normalizes older native recordings in memory; raw saved files remain unchanged. Each regrade records its own harness and source provenance. Comparison selects an entire grading revision and checks both execution conditions and grading criteria.

Cancellation travels through an `AbortSignal` from the CLI to the active adapter. A cancelled Pi run retains its observed usage and artifacts; cancelling a later grader preserves Pi’s execution status. Cleanup and evidence sealing finish before the CLI returns its signal exit code. Keep these phases separate when extending the lifecycle.

## Preserve the important distinctions

- **Execution and judgment:** an interrupted trial can have a passing artifact outcome. A completed run can have unknown compliance.
- **Actor and evidence:** evaluator-run checks cannot earn agent compliance. Raw command text alone does not prove execution.
- **Skill availability, discovery and loading:** copied files and descriptions do not prove content was read. Adherence and useful outcome need separate judgments.
- **Subscription and API cost:** Pi token/runtime limits remain active; the direct API allowance is independent when the verified subscription profile disables Pi’s dollar threshold.
- **Original and regraded results:** new judgments append a revision rather than overwrite history or silently merge selected passes.

Native-specific decoding belongs in `pi-evidence.ts` and `playwright-evidence.ts`, including discovery shapes, error flags, tool-boundary receipts and browser output. `ToolReceipt` distinguishes file operations, shell commands, browser commands and unknown attestation. Invalid fields, missing exit status or mismatched snapshot fingerprints cannot become successful receipts. Domain graders consume these typed facts without parsing native stdout formats. Extend that seam when supporting another protocol or new evidence, and retain the raw source for audit.

## Check a change

From the repository root:

```bash
pnpm evals validate
pnpm check:evals
pnpm test:evals
```

These commands are offline and never start a model. Tests use normalized evidence, authored/minimized native traces, in-memory ports and controlled fake processes. Add cases that distinguish the intended behavior from plausible false positives and failure paths.

`check:evals` runs TypeScript, lint and formatting checks for this package. Use `pnpm --dir tools/agent-evals format` to apply its formatter after editing package files.

The explicit native tooling check is separate:

```bash
pnpm --dir tools/agent-evals exec tsx test/isolation-native-smoke.ts
```

It exercises the local sandbox and real browser tools without a model call. It requires the same local Pi/tool installations as the environment adapter and may prepare/refresh native authentication. Its observations are attributed to environment/evaluator activity, not an agent obeying the instruction.

A live Pi/API check always uses an explicit CLI command. Keep it outside ordinary tests and CI defaults. Run root application checks separately when changing workspace configuration or application code.

## Current scope

The environment adapter supports a synthetic, dependency-free Wedding fixture on macOS, resolving Intel and Apple Silicon browser installations. Native verification so far used Apple Silicon. It uses native Pi with recorded instruction/skill resources and a controlled extension profile. It does not evaluate the full Next.js/Supabase production workflow. Semantic calibration still awaits human labels.

The first extension milestone is a focused `diagnose` suite, followed by repeated controlled comparisons with a shared experiment budget. Add concepts such as suites and experiment scheduling when that work needs them; the current package needs only one-trial orchestration and saved-evidence operations.
