# Agent evaluations

Run a small coding task with native Pi, inspect what it actually did, and regrade the saved evidence without running it again. The pilot evaluates the repository’s browser-validation instruction on a synthetic Wedding page, with a docs-only task for applicability.

[Add an evaluation](authoring.md) · [Package architecture](../tools/agent-evals/README.md) · [Verified runs and costs](verification-2026-09-07.md)

## Start here

From this checkout, use `nvm use` and `pnpm install` once. The live environment currently requires macOS, Pi, `playwright-cli`, an installed Chromium headless shell and the repository’s pinned pnpm runtime. The resolver supports Apple Silicon and Intel installations; native verification so far used Apple Silicon. `doctor` checks local prerequisites before a trial.

```bash
pnpm evals tasks
pnpm evals validate
pnpm evals doctor --no-grader
pnpm evals run ui-copy --dry-run
```

`tasks`, `validate` and `--dry-run` are offline. `doctor --no-grader` inspects native Pi and local tools without an agent prompt or billed generation. The dry run shows the task, profile and cost bounds so you can inspect them before dispatch.

Run one trial, then read its result:

```bash
pnpm evals run ui-copy --no-grader
pnpm evals show latest
```

This runs Pi using its own authentication. The included profile allows five minutes and 300,000 observed cumulative tokens. `--no-grader` skips the separately billed semantic judgment; deterministic outcome and browser grading still run. Progress appears while Pi works. The final summary includes individual verdicts, usage, any failure cause and the saved report path.

For a docs-only applicability check:

```bash
pnpm evals run docs-only --no-grader
```

Browser compliance should be `not-applicable`; an agent may still choose to use a browser. A trial’s execution status remains separate from its grades.

## Add the cheap semantic grader

Keep the direct OpenAI key in **`.env.evals.local` in the original checkout**:

```dotenv
OPENAI_API_KEY=your-key
```

The `.env*` ignore rule covers this filename. Worktrees resolve the original checkout through Git’s common directory; `--grader-env-file PATH` overrides it. The evaluator reads this key privately. It is never copied into the trial workspace or Pi’s environment.

```bash
pnpm evals doctor
pnpm evals grader-smoke
pnpm evals run ui-copy
```

`doctor` also checks key/model access without billed generation. `grader-smoke` makes one small structured-output API call using authored evidence. `run` invokes Pi, deterministic graders and one semantic API call. Luna is the default, using direct `@ai-sdk/openai`; there is no automatic model fallback. Its availability and structured output support were checked against [OpenAI’s model documentation](https://developers.openai.com/api/docs/models/gpt-5.6-luna).

| Included profile                | Bound                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| Pi billing                      | Verified `openai-codex` OAuth subscription; excluded from the API dollar allowance   |
| Pi execution                    | One trial, 300,000 observed tokens, 300 seconds, zero automatic retries              |
| API allowance                   | $1 estimated allowance per invocation                                                |
| Semantic grader                 | `gpt-5.6-luna`, 18,000 input characters, 800 output tokens, 20 seconds, zero retries |
| Conservative grader reservation | $0.00456 at the recorded rates                                                       |

Agent usage and grader usage are reported separately. Pi’s catalog estimate is audit metadata when the subscription profile disables its dollar threshold. Missing usage or cost stays unknown. Usage checks may overshoot during an in-flight response, and these are application estimates rather than provider-enforced spending caps. Each invocation has its own allowance; a shared experiment ledger and aggregate budget are future work.

Use `--budget-usd 0.01` to lower an invocation’s direct API allowance. Inspect profiles with `pnpm evals profiles`, and select one with `--profile NAME`. With the included profile, the catalog prints:

```text
Profiles

NAME   PI BILLING    TOKEN LIMIT  DEADLINE  API ALLOWANCE  GRADER
smoke  subscription  300,000      5m 00s    $1             gpt-5.6-luna
```

A different grader model requires explicit price estimates:

```bash
pnpm evals grader-smoke --grader-model MODEL_ID --grader-input-price INPUT_USD_PER_MILLION --grader-output-price OUTPUT_USD_PER_MILLION
```

## Work with saved results

A run reference can be `latest`, a full run ID, or a directory path. Relative paths resolve from where you invoked pnpm, with repository-relative paths also supported.

```bash
pnpm evals runs --limit 5
pnpm evals show latest
pnpm evals show latest --grades original
pnpm evals regrade latest
pnpm evals show latest
```

`show` includes grading history and defaults to the latest grading revision. `--grades original` selects the original judgments; `--grades regrade-TIMESTAMP` selects a named revision shown in that history. A revision is selected as a whole. An offline deterministic regrade does not silently inherit an earlier semantic grade.

An incomplete or invalid latest revision is reported instead of silently selecting an older result. Use `show RUN_ID --grades original` to inspect the intact original evidence, or `regrade RUN_ID` to append a fresh revision. Older unsealed regrades remain visible with a provenance warning.

`regrade` verifies saved evidence, runs the current deterministic graders and writes a separate timestamped report. Pi does not run again, original results remain intact, and an interrupted trial keeps its original execution status even if its known outcomes pass. Add `--semantic` for one new bounded API judgment:

```bash
pnpm evals regrade latest --semantic --budget-usd 0.01
```

If a live trial needs another attempt, link it explicitly:

```bash
pnpm evals run ui-copy --retry-of RUN_ID --no-grader
```

This preserves the earlier failure. A retry after a harness, model or profile change is debugging evidence rather than a matched comparison.

Press **Ctrl-C** to stop a live run. The CLI requests native abort, stops child processes and finishes cleanup/evidence writes before exiting. A started trial records `cancelled` when Pi or setup was interrupted. Cancellation during semantic grading preserves Pi’s completed execution and records the cancelled grader separately. Unreported in-flight API usage remains unknown. Wait for cleanup to finish; repeated signals do not skip it.

For shell scripts, suppress pnpm’s wrapper output and request JSON:

```bash
pnpm --silent evals runs --json
pnpm --silent evals show latest --json
```

The CLI returns `0` for success, `1` for invalid input or unreadable/unusable saved evidence, and `2` for a failing or unknown evaluation, grader error, or ineligible comparison. Cancellation exits with `130` for Ctrl-C (`SIGINT`) or `143` for `SIGTERM`. `show` is an inspection command and succeeds when it can read the selected revision, even if that trial failed. pnpm may wrap a nonzero child status; inspect the result’s explicit status and verdicts when automating. With `--json`, results go to stdout and errors go to stderr.

## Command reference

| Command                         | Purpose                                         | Model activity                       |
| ------------------------------- | ----------------------------------------------- | ------------------------------------ |
| `tasks`, `profiles`, `validate` | Discover inputs and validate configuration      | Offline                              |
| `run TASK --dry-run`            | Preview configuration and admission bounds      | Offline                              |
| `doctor --no-grader`            | Check local tools and native Pi settings        | No agent prompt or billed generation |
| `doctor`                        | Also check grader key/model access              | No billed generation                 |
| `run TASK`                      | Prepare, run, grade and retain one trial        | Pi and one semantic API call         |
| `run TASK --no-grader`          | Run Pi with deterministic grading               | Pi only                              |
| `grader-smoke`                  | Check semantic output and verifiable citations  | One API call                         |
| `runs`, `show`, `compare`       | Inspect retained trials and comparisons         | Offline                              |
| `regrade RUN`                   | Apply current deterministic graders to evidence | Offline                              |
| `regrade RUN --semantic`        | Also obtain a new semantic judgment             | One API call; Pi is not rerun        |

`pnpm evals help COMMAND` shows command-specific options. The original `smoke --task NAME` spelling remains an alias for `run NAME`. Invalid combinations are rejected before a live trial starts.

## Read a judgment correctly

A **task** describes work; a **trial** executes it under fixed conditions. The **transcript** captures attributed events, the **outcome** is the resulting artifact, and **graders** judge specific claims. The **evaluation harness** coordinates them. These terms follow [Anthropic’s agent-evaluation guide](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents).

| Judgment                | What it establishes                                                                                                                                             |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `target-outcome`        | The evaluator-observed target contains the expected task text. Broader semantic quality is judged separately.                                                   |
| `browser-behavior`      | The agent successfully navigated the local changed flow and explicitly captured a snapshot after the final observed change. Docs-only tasks are not-applicable. |
| `browser-compliance`    | The required browser behavior occurred when the instruction applied. Disabled instructions and docs-only tasks are not-applicable.                              |
| `semantic-task-clarity` | A bounded, provisional assessment of the resulting target’s clarity and intended behavior, with verified quotations.                                            |

Verdicts are **pass**, **fail**, **unknown** and **not-applicable**. Execution statuses are **completed**, **cancelled**, **agent_error**, **infrastructure_error**, **timeout** and **budget_exceeded**. A useful artifact may survive an interrupted trial. A completed agent turn may still receive unknown compliance when evidence cannot establish what happened.

Browser grading requires successful native command evidence, matching local URLs and sessions, a final target hash that agrees with the observed change, and explicit snapshot YAML. An automatic snapshot from `open`, screenshot, command mention or self-report is insufficient. Navigation may precede the edit if a later snapshot verifies the final change. Supported evidence includes direct CLI commands and the narrow literal `playwright-cli [-s=NAME] open URL && playwright-cli [-s=NAME] snapshot` pair, including `goto`. Additional shell wrappers remain unknown unless independently attested. Captured native snapshot output survives workspace-file cleanup; a retained conflicting file yields unknown.

Every event identifies its actor: agent, environment or evaluator. Environment preflights and evaluator observations cannot earn agent compliance. Skill files being available, native discovery, actual content loading, adherence and useful outcome are separate observations. A skill description or the agent claiming to use a skill does not prove its content was loaded.

Semantic evidence is untrusted data. The grader has no tools, validates quotations against evidence IDs and reports invalid output, citations or API failures as grader errors. [Calibration cases](calibration/task-clarity.json) include pass, fail, missing-evidence and injection scenarios. Their authored expectations still require human labels, reviewer and date. The live smoke demonstrates connectivity and valid structured output; it does not establish agreement with human judgment.

## Compare an instruction variant

The enabled variant retains the current repository AGENTS.md. The disabled variant removes exactly:

> Always validate user-facing app changes with `playwright-cli` against the local development server in addition to lint/build checks. Capture at least one `playwright-cli snapshot` for the changed flow.

The environment records the removed text and before/after hashes. To compare a pair, keep the task, fixture, starting revision, model/reasoning, runtime, budgets, resource versions and grading criteria fixed:

```bash
pnpm evals run ui-copy --variant enabled --no-grader
pnpm evals run ui-copy --variant disabled --no-grader
pnpm evals runs --limit 2
pnpm evals compare ENABLED_RUN_ID DISABLED_RUN_ID
```

`compare` verifies evidence and selects complete grading revisions with `--grades latest` or `--grades original`, applying that selection to both trials. `show` also accepts an individual named revision. Comparison reports mismatched conditions by field, plus execution status and grades for each trial. Literal duplicate startup instructions make a pair ineligible; review semantic equivalents and instructions loaded during the trial as additional possible confounders.

A matched pair records observations. Estimating usefulness needs repeated trials, balanced/randomized ordering and uncertainty reporting. A few successful disabled runs cannot establish that an instruction is unnecessary.

## Evidence and local isolation

Saved trial directories are ignored under `evals/runs/`:

| File                                          | Contents                                                                            |
| --------------------------------------------- | ----------------------------------------------------------------------------------- |
| `report.md`                                   | Verdicts, causes, model, timing, usage and links                                    |
| `manifest.json`                               | Task/fixture/harness/runtime provenance, configuration, budgets and attempts        |
| `inspection.json`, `environment.json`         | Normal Pi resources, effective trial resources, exact variant and isolation details |
| `transcript.jsonl`, `evidence.json`           | Attributed raw events, normalized observations and captured artifacts               |
| `grades.json`, `semantic.json`, `skills.json` | Original judgments, optional semantic output/citations and skill observations       |
| `integrity.json`                              | Digests checked before reading evidence for regrading/comparison                    |
| `regrade-*.json`, `regrade-*.md`              | Separate grading revisions and their source provenance                              |

Doctor, comparison and standalone grader-smoke directories contain their relevant subset of artifacts. `runs` lists actual trials. Keep saved evidence private; it may contain local paths and instruction text. Failed workspaces remain inspectable, while cleanup stops processes and removes private authentication copies.

Native Pi’s RPC protocol was verified with version 0.85.1. The runner waits for `agent_settled`, verifies the saved model/reasoning and requires the isolation extension’s readiness marker before prompting. It retains native tool behavior and errors while the adapter translates events into provider-independent observations. Legacy evidence is normalized in memory without rewriting its original files.

Pi keeps its selected provider/model and reasoning settings. Before a trial, native Pi refreshes the selected credential when needed under its original store’s locking and persists the refresh there. The evaluator then creates a private copy containing only that provider, verifies validity for the full bounded run and removes the copy during cleanup. Original settings and model selection remain unchanged; authentication may be refreshed through Pi’s normal mechanism. The grader key is independent of this process.

The controlled profile copies Pi’s selected instruction and skill sources, preserving native precedence, scope and ancestor order. It suppresses optional extension/package code, including the normal auto-caveman injection and subagent package. Before prompting, native discovery verifies the prepared sources under the isolated HOME. Provenance records source/destination hashes, trust differences and complete copied skill-tree fingerprints, including helpers and file modes.

Pi may treat a new worktree as untrusted. `doctor` shows that state and the actual selected skill count; project skills suppressed by Pi remain excluded from the fixture. The synthetic fixture is trusted only to activate the deliberately copied resources, and that difference is recorded. Your saved source-checkout trust is unchanged. These results describe this controlled profile rather than every aspect of daily Pi usage.

The fixture runs in a fresh synthetic Git checkout with local data. The production-linked `sbx/pi-wedding-planner` startup is excluded. OS restrictions allow workspace/home/temp writes, selected runtime/resource reads and loopback networking to the fixture. Rubrics, expected-answer controls, reports, the grader key and private Pi credentials remain outside agent-tool access. Sandboxed Git and pinned pnpm lint/build are preflighted before the prompt and attributed to environment setup. The implementation worktree’s mandated application `.env.local` copy never enters trials.

## Development and next milestones

```bash
pnpm check:evals
pnpm test:evals
```

These checks are offline. The independent workspace package is excluded from the Next.js application’s TypeScript/lint scopes; its own strict typecheck and behavioral tests cover transport, evidence, grading, isolation and failure handling. See [the package guide](../tools/agent-evals/README.md) for code boundaries and [authoring](authoring.md) for extension recipes.

The next skill candidate is **diagnose**: natural activation prompts that never name the skill, similar non-debugging negatives, and a separate explicitly loaded execution suite. Measure availability, discovery, loading, adherence and outcome independently.

Repeated comparisons need ordinary TypeScript scheduling, a shared spend ledger, retained failed attempts and human semantic calibration. CI can start with the offline checks. Opt-in live CI needs a Linux/container environment adapter, dedicated test-account authentication and private retained artifacts. Broader suites and dashboards remain deferred.
