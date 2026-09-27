# Wedding evaluation example

This directory consumes the shareable [`agent-evals` library and CLI](../packages/agent-evals/README.md). It owns Wedding's task, local environment, acceptance checks, evidence Views, and graders. It imports only public package entry points. The library provides execution/recording helpers, grading orchestration, provider adapters, and persistence.

| Consumer file                                                            | Responsibility                                                                   |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| [config.ts](config.ts)                                                   | Compose the suite; lazily create the Pi runner and Jev judge                     |
| [tasks/login-retry.ts](tasks/login-retry.ts)                             | Natural task prompt, pinned revision, starting defect, and acceptance metadata   |
| [environment/prepare.ts](environment/prepare.ts)                         | Isolated local checkout, services, Pi resources, final observations, and cleanup |
| [environment/isolation/](environment/isolation/)                         | Tool boundary, sandbox, and preflight checks                                     |
| [environment/repository/](environment/repository/)                       | Source checkout, repository evidence, and acceptance checks                      |
| [environment/runtime/](environment/runtime/)                             | Local runtime discovery, process management, and cleanup                         |
| [views/diagnosis/index.ts](views/diagnosis/index.ts)                     | Explicit diagnostic episodes and semantic questions                              |
| [views/completed-diagnosis/index.ts](views/completed-diagnosis/index.ts) | First completed diagnostic test attempt and prefix audit                         |
| [views/validation-history/index.ts](views/validation-history/index.ts)   | Agent edit and validation history with final-revision grading                    |
| [views/shared/](views/shared/)                                           | Evidence helpers and verification command parsing shared by views                |
| [completed-attempt.config.ts](completed-attempt.config.ts)               | Scoped regrading with a revised hypothesis question                              |

## Run the example

Use Node 24 and this repository's pnpm version. Live execution requires macOS, native Pi with authenticated `gpt-6-luna`, `playwright-cli`, and the Chromium headless shell used by the application's Playwright package. Dependencies matching the task's pinned commit must already be installed in the original checkout; trials copy them privately. `COREPACK_HOME` and `PLAYWRIGHT_BROWSERS_PATH` support nonstandard caches.

Keep `TYPESAFE_API_KEY` in this worktree's ignored `.env.local`. Only the consumer's lazy judge factory reads it. Pi uses its existing subscription authentication separately. Application credentials and the Jev key do not enter the evaluated agent's environment.

```bash
nvm use
pnpm install
pnpm build:evals
pnpm evals run --config evals/config.ts --dry-run
pnpm evals run --config evals/config.ts
pnpm evals show RUN_ID
pnpm evals regrade RUN_ID --config evals/config.ts
```

`pnpm build:evals` also compiles the consumer’s three standalone runtime helpers from `.mts` (TypeScript ES modules) into ignored `evals/dist/`. Rebuild after editing those helpers. Trials copy the emitted `.mjs` files into private controls and run them with plain Node or Pi, without a TypeScript loader. Trial provenance records hashes of all three copied scripts alongside the authored environment source hash.

`run` records one native Luna attempt at repairing the login form, then applies two diagnostic Jev questions and a deterministic validation check. The task describes a form stuck after an unsuccessful submission without naming a skill or revealing the cause. Independent acceptance exercises two real local Server Actions, required-input validation, pending state, and error feedback.

`show` reads only saved records. `regrade` appends grades without starting Pi. `--code-only` selects deterministic graders and skips the judge factory. `--dry-run` loads trusted configuration but invokes neither factory. Use `--json` for machine-readable output and `pnpm evals --help` for generic options. Trial execution status and behavioral verdicts are separate: exit 1 means command setup/storage failed; exit 2 means recorded execution/preparation/grading failed. A completed `fail` or `unknown` verdict does not change the exit code. CLI summaries include `failures` with each failed grader’s status and safe reason; an empty judge usage list can mean preparation failed before any request was sent.

New records live under ignored `.agent-evals/` in the invocation directory. `--store PATH` changes that location. Earlier recordings remain readable by supplying `--store evals/runs/library` to `show` or `regrade`; no migration is required. The Pi adapter retains incremental native recordings under `<store>/recordings/TRIAL_ID/`; the consumer creates private environment workspaces under the operating system’s temporary directory. Explicit native probes save their observations under ignored `evals/runs/`.

## Limits and native configuration

The shared defaults remain **30 minutes, 100 completed turns, and 1,000,000 weighted tokens per trial**. Any reached limit stops the trial. Weighted usage is `input + output + 0.1 × (cacheRead + cacheWrite)`; raw usage is retained. Runtime covers Pi startup and execution, excluding environment preparation, final acceptance, and grading. A turn includes the assistant response and resulting tools. Usage may overshoot while a response is in flight; shutdown does not extend execution runtime.

```bash
pnpm evals run --config evals/config.ts --max-runtime-ms 1800000 --max-turns 100 --max-tokens 1000000 --dry-run
```

Limits resolve field by field from shared defaults, runner options, task limits, then explicit trial/CLI overrides. Counters reset per repetition. Values must be positive safe integers, and runtime must fit Node's timer range. The environment and authentication deadlines use the resolved runtime; credentials must remain valid long enough.

The consumer selects Luna and the native catalog endpoint while preserving supported saved reasoning, compaction, and retry settings. There is no model fallback or global Pi configuration mutation. The adapter records saved and effective model/endpoint identities. Complex custom credentials or model definitions are rejected rather than redirected.

Resource discovery uses the original checkout's actual trust decision. `EVAL_AGENT_SOURCE` selects another resource checkout. Instructions, skills, selected resources, and effective configuration are recorded with hashes; copied resources are resolved through native Pi before prompting. Trusted project-specific runtime overrides in `.pi/settings.json` are rejected rather than silently ignored. The tool surface is `read`, `bash`, `edit`, and `write`; optional extensions/packages and subagents are excluded, including automatic caveman injection. This differs from a full interactive Pi session.

Jev uses pinned `jev-1.13.0`, concurrency one, a 20-second request timeout, and no SDK retries. The consumer config sets a $0.01 aggregate admission allowance per command; `--budget-usd` overrides it. Estimates are application controls, not provider-enforced spending caps. Pi subscription usage is separate.

## Inspect and revise evidence

| Store record                                   | Contents                                                                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `trials/TRIAL_ID.json`                         | Observable normalized trace, native source payloads, artifacts, historical instruction/skill contents, outcome, and provenance |
| `runs/RUN_ID.json`                             | Trial IDs and original grading IDs                                                                                             |
| `gradings/GRADING_ID/grading.json`             | Exact evidence, references, hashes, versions, questions, request membership, responses, errors, and usage                      |
| `gradings/GRADING_ID/report.md`                | Readable evidence, scope, omissions, verdicts, and requests/responses                                                          |
| `gradings/GRADING_ID/requests/REQUEST_ID.json` | Credential-free request body journaled before dispatch                                                                         |

Historical context comes from the recording, never today's files. Source references identify audit material; they do not give Jev access to omitted content. A request journal proves preparation, not successful dispatch. Interrupted grading attempts retain their journals; completed grading records track dispatch and responses. Stores refuse overwrites and regrading preserves earlier records. Hashes detect accidental changes, not malicious rewriting. Recordings can contain private paths and instruction text.

The diagnostic View selects visible hypothesis windows using a lexical heuristic, retaining subsequent conversation/tools, failed attempts, contradictions, and the preceding tool result. If no hypothesis matches, it supplies broader observable conversation rather than asserting diagnosis was absent. It does not submit hidden reasoning or all captured instruction/skill text. Complete recording coverage does not guarantee that an episode answers the question.

Two model graders ask whether a hypothesis is falsifiable and whether an actual probe tests it. Failed tests can be relevant probes. Jev batches questions only when their full submitted evidence envelopes match, including scope, references, and coverage. Reports retain categorical answers, probabilities, confidence, and usage without invented explanations or supporting quotations. Rollup is any fail, otherwise unknown, otherwise pass, otherwise not applicable. Episodes from one trial are not independent attempts.

The deterministic validation View requires agent-attributed validation after the final observed edit and checks the target's final fingerprint. Evaluator acceptance and agent claims cannot earn validation credit. Supported receipts include literal lint/build/test commands, direct `playwright-cli snapshot`, and literal browser chains joined with `&&` ending in an explicit snapshot. Supported chain actions are `open`, `goto`, `reload`, `fill`, `click`, and numeric `sleep`, using one session. A snapshot followed by arbitrary `eval` remains unsupported; a provably browser-only chain limits that uncertainty to the browser check. Native calls/results and retained output hashes must agree. Unsupported syntax remains visible. A later successful check on the final revision supersedes earlier completed uncertain attempts; overlapping or later uncertainty still blocks the affected check. Missing tool status remains unknown rather than a behavioral failure. A successful arbitrary shell command does not establish validation.

### Regrade a scoped attempt

Oversized evidence is rejected without silent truncation, with actual and configured character counts in the error. Default Jev state is limited to 18,000 characters with additional conservative byte-based context checks. The alternative consumer config demonstrates changing scope and a question through ordinary TypeScript:

```bash
pnpm evals regrade RUN_ID --config evals/completed-attempt.config.ts
```

It selects the first visible hypothesis, every intervening tool call’s arguments and result status through the first literal test attempt’s completed native turn, and the selected test’s exact output. The selected call is identified explicitly. It then asks the sharper version-2 hypothesis question. The View audits continuity from native start, source payloads, paired calls/results, and recorded context fingerprints. For interrupted trials, only terminal gaps proven to occur after that boundary are waived. The parent trial's status stays unchanged, and trial-wide validation still sees its original incomplete recording.

Earlier tool contents, intermediate result text, later activity including contradictions/repairs, and context text are explicitly omitted from this semantic input. The full recording and source references preserve them for inspection, but Jev cannot see that omitted content. If it is needed to interpret the selected attempt, the judgment must remain unknown. Duplicate text is removed; repeated lines can use `line-dictionary-v1`, whose ordered references reconstruct exact text including line endings. This is deterministic encoding, not a generated summary. The scoped config allows 30,000 state characters under the same context checks. It grades the selected attempt, not eventual repair. Human calibration remains outstanding.

To revise grading, edit the consumer View/question/rubric, bump its version, and regrade the saved run. No library or adapter change is needed. New tasks similarly provide their own environment metadata and acceptance checks; the Pi adapter does not load a Wedding catalog.

## Verify and interpret

```bash
pnpm check:evals
pnpm test:evals
pnpm exec tsx evals/probes/repository-native-smoke.ts
pnpm exec tsx evals/probes/playwright-package-native-smoke.ts
```

The first two commands are offline. The explicit native probes exercise local browser/tool isolation without model calls. `pnpm exec tsx evals/probes/jev-live-smoke.ts --live` is an optional paid transport probe; it does not establish calibration.

The fixture exercises the real Next.js login UI against an unavailable loopback authentication endpoint. It does not test successful authentication, database behavior, or production integration. Offline font responses and webpack builds are explicit environment differences. Agent actions, environment setup, and evaluator checks retain separate attribution.

Cleanup stops registered process groups, removes private configuration, and stops local services. It cannot guarantee termination of a tool-created child that detaches into another process group; that child may continue writing the trial workspace. Source-stability checks compare captured snapshots and do not prove that no writes happened between them. Generated caches and immutable dependencies are excluded from source capture.

One trace establishes integration, not judge accuracy, natural skill-selection quality, or instruction benefit. Those need contrasting hand-reviewed examples and fresh matched trials. Removing instructions from a recording is not an ablation. Availability, discovery, loading, adherence, and outcome remain separate observations. Broad experiment matrices are deferred.
