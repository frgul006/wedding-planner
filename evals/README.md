# Coding-agent evaluations

Run native Pi on a pinned checkout of Wedding Planner, check its changes independently, and compare the browser-validation instruction enabled versus disabled.

```bash
nvm use
pnpm install
pnpm evals experiment repository-ui-copy --dry-run
pnpm evals experiment repository-ui-copy
```

One command runs the two trials sequentially, keeps both results (including failures), and writes a comparison and a shareable review summary. It does not make grader API calls unless you add `--semantic`. Pi uses its existing model and authentication; subscription usage has separate token/runtime bounds.

[Author a task or grader](authoring.md) · [Code map](../tools/agent-evals/README.md) · [Real-repository verification](verification-2026-09-16.md)

## Prerequisites

Live execution currently requires macOS, installed native Pi, `playwright-cli`, Chromium headless shell, and this repository's Node/pnpm versions. Dependencies for the pinned Wedding commit must already be installed in the original checkout. Trials copy them privately; they do not download packages. `COREPACK_HOME` and `PLAYWRIGHT_BROWSERS_PATH` are supported for nonstandard tool caches.

```bash
pnpm evals doctor --no-grader
pnpm evals tasks
pnpm evals validate
```

These commands do not prompt an agent or generate a billed response. `doctor --semantic` also checks direct grader API access.

Pi's resource selection is inspected in the **original checkout**, preserving its actual trust decision. `--agent-source PATH` selects another checkout explicitly. This avoids accidentally losing repository skills just because the evaluation implementation runs in an untrusted worktree. Reports retain the inspected and effective resources, their hashes, and any profile differences.

## What the repository tasks test

| Task                     | Work                                  | Independent acceptance                                                          |
| ------------------------ | ------------------------------------- | ------------------------------------------------------------------------------- |
| `repository-ui-copy`     | Clarify the real admin login button   | Rendered label, pending state, error feedback, lint/build                       |
| `repository-login-error` | Repair invisible login error feedback | Visible error after submission, pending behavior, lint/build                    |
| `repository-docs`        | Explain local login-page verification | Documentation checks and application checks; browser instruction not applicable |

All three use the real TypeScript/React application at the full commit pinned in their task JSON. Prompts do not repeat the browser-validation instruction. The error task starts with an explicitly recorded one-line defect in the real login component. The old `ui-copy` and `docs-only` synthetic tasks remain small regression fixtures.

The app runs Next.js with local-only environment values and an unavailable loopback authentication endpoint. This exercises rendering and failure feedback without a database. It does **not** test successful authentication, Supabase integration, or the broader wedding workflows. Offline font responses and webpack for development and production builds are recorded environment differences. The agent receives the supported `pnpm build --webpack` command as runtime context. Default Turbopack requires process/port access outside this boundary. The evaluator verifies the pinned and installed dependency locks before disabling pnpm’s automatic reinstall of copied dependencies. The production-linked Pi sandbox and application credentials are never used.

The evaluator stops agent descendants, runs its own checks, captures before/after source and a full source-change patch, then cleans up. Generated caches and immutable installed dependencies are excluded from source capture. Its checks never count as evidence that the agent obeyed an instruction. Acceptance code and expected answers stay outside the agent's writable workspace.

## Native Pi configuration

The default `smoke` profile preserves the saved provider, model, reasoning, conversation compaction and retry settings. Native Pi resolves the copied instructions and skills again before prompting. The `controlled` profile explicitly disables native compaction/retries for comparison.

Trusted project-specific runtime overrides in `.pi/settings.json` are currently rejected with an actionable error; the adapter does not silently ignore them. Supporting their effective merged settings is a remaining Pi-adapter extension.

Both profiles use the same isolated four-tool surface (`read`, `bash`, `edit`, `write`). Optional Pi extension/package code is excluded: arbitrary extension tools and subagents could bypass this adapter's tool restrictions. This includes the usual automatic caveman injection. **This is a documented isolated Pi configuration, not a claim of parity with every extension in an interactive Pi session.** Full extension/subagent fidelity remains a separate environment-adapter requirement.

The included profiles allow one trial at a time, 15 minutes and 1.5 million observed cumulative Pi tokens, with no automatic trial retry. Native provider retries still apply in the native profile and consume the same outer bounds. Costs or tokens unreported by the provider remain unknown. Limits may overshoot during an in-flight response.

## Read or regrade a result

```bash
pnpm evals run repository-ui-copy
pnpm evals show latest
pnpm evals regrade latest
pnpm evals regrade latest --graders acceptance-checks,diff-scope
pnpm evals show latest --grades original
pnpm evals runs --limit 5
```

A run reference accepts `latest`, a run ID, or a directory. Regrading uses the same task-selected grader registry as a live run and appends a revision without rerunning Pi or replacing original evidence. Incomplete grading revisions are reported rather than silently skipped. `--json` produces machine-readable output; use `pnpm --silent evals ... --json` in scripts.

`--graders` selects new judgments for an existing recording; the revision records the selection while original task expectations remain sealed.

Execution status and judgments are separate. A completed run can have failing grades; an interrupted run can leave useful changes. In an experiment, an expected failure in the disabled condition does not stop the other trial from running. Ctrl-C stops the active trial and finishes evidence writes and cleanup.

| Judgment                | Claim                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| `target-outcome`        | Expected text is present; deliberately a narrow check                                               |
| `acceptance-checks`     | Independent evaluator checks of the final application passed                                        |
| `diff-scope`            | Captured changes stay within the task's declared file scope                                         |
| `browser-behavior`      | The agent successfully visited the changed local flow and explicitly captured the required snapshot |
| `browser-compliance`    | That observed behavior satisfies the instruction when applicable                                    |
| `semantic-task-clarity` | Optional provisional judgment of task quality from before/after/patch evidence                      |

Verdicts are `pass`, `fail`, `unknown`, and `not-applicable`. Successful browser commands require attributed native evidence and matching artifact fingerprints. Screenshots, command mentions and self-reports are insufficient. Skill availability, native discovery, content loading, adherence and outcome are distinct observations.

## Optional cheap semantic grading

Keep `OPENAI_API_KEY` in the ignored `.env.evals.local` in the original checkout. It is loaded privately and never enters Pi or the trial workspace. `--grader-env-file PATH` overrides the location.

```bash
pnpm evals experiment repository-ui-copy --semantic --budget-usd 0.02
pnpm evals regrade latest --semantic --budget-usd 0.01
```

The experiment reserves the **aggregate** direct API allowance before dispatching either trial. The default Luna grader allows 18,000 input characters, 800 output tokens, 20 seconds and no SDK retry. At the [recorded Luna prices](https://developers.openai.com/api/docs/models/gpt-5.6-luna), a call reserves $0.00456; a pair reserves $0.00912. Reservations are conservative application estimates, not provider-enforced spending caps. Pi subscription usage is excluded from this dollar allowance and reported separately.

The grader has no tools, treats evidence as untrusted, validates quoted citations and records failures separately. Oversized evidence is rejected instead of silently truncated. Its calibration examples still need human labels; a working API call does not establish grading accuracy. Alternate models require explicit prices, with no expensive automatic fallback.

## Comparisons and evidence

```bash
pnpm evals compare ENABLED_ID DISABLED_ID
pnpm evals compare FIRST_ID SECOND_ID --factor agent-configuration
pnpm evals compare FIRST_ID SECOND_ID --factor model
```

Declare the factor that may differ. Everything else, including the task, application revision, budgets, evaluator implementation and selected grading criteria, must match. Audit locations are retained separately from content identities so moving a checkout does not itself change the experiment. Duplicate active browser instructions make an instruction comparison ineligible.

A pair demonstrates observations and validates the workflow. It does not estimate reliability or establish that the instruction is unnecessary. Repetition, balanced ordering and human semantic calibration are required before making usefulness claims.

Private recordings live under ignored `evals/runs/`: `manifest.json`, `environment.json`, `inspection.json`, `transcript.jsonl`, `evidence.json`, grading results, integrity digests and readable reports. Evidence includes local paths and instruction text. The experiment's allowlisted review summary omits raw prompts, transcript content, source content and private paths; it is shareable context, not a replacement for the complete private recording.

## Developing the evaluator

```bash
pnpm check:evals
pnpm test:evals
```

Both run offline in CI. Live Pi/browser checks are separate explicit commands. See the [package guide](../tools/agent-evals/README.md) for responsibilities and [authoring guide](authoring.md) for extension recipes.

Next research steps: natural `diagnose` activation positives and near-miss negatives, explicit skill-execution cases, repeated trials, and a runtime supporting the complete native extension/tool surface. Keep each claim tied to the configuration and evidence actually observed.
