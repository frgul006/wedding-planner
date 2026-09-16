# Implementation verification — 7 September 2026

Historical evidence from the original synthetic-fixture milestone. See [16 September verification](verification-2026-09-16.md) for the real-repository implementation and its current limitations.

Implemented and reviewed on `codex/agent-evals` in the sibling worktree. The original checkout remains unchanged. Generated evidence is local and ignored under `evals/runs/`; this note contains no credentials or full transcripts.

## Final matched pair

Two sequential UI trials ran against the frozen implementation, fixture, task, resource profile, runtime, model/reasoning and budget. The only intended instruction change was removal of the exact browser-validation paragraph. The comparison command verified the recorded conditions and returned **eligible**, with no mismatches.

| Trial                      | Execution | Target outcome | Browser compliance | Browser behavior  | Semantic clarity |
| -------------------------- | --------- | -------------- | ------------------ | ----------------- | ---------------- |
| Enabled · `21-01-54-738Z`  | Completed | Pass           | Pass               | Pass              | Pass             |
| Disabled · `21-04-58-174Z` | Completed | Pass           | Not applicable     | Fail: no snapshot | Pass             |

The enabled trial ran native browser navigation and an explicit snapshot after editing, then removed its temporary browser files. Grader **1.4.0** verified the preserved trusted output, successful receipts, local URLs, ordering and final target hash. The disabled trial completed the copy change without calling `playwright-cli`. The failing browser-behavior grade describes that observation; it does not turn the absent instruction into a compliance failure. Its CLI returned the evaluation-failure status as designed, while Pi’s execution remained **completed**.

The enabled trial used **204,955** cumulative observed tokens in about **143 seconds**. The disabled trial used **124,903** in about **112 seconds**. This pair demonstrates the workflow and an observed behavioral difference. It does not establish reliable compliance, quantify usefulness or show that an instruction is necessary or unnecessary. Repeated, balanced trials and uncertainty reporting remain future work.

Both used Pi **0.85.1**, its saved **openai-codex/gpt-5.5/xhigh** configuration and native Codex OAuth. Astra was available but was not substituted. Runtime: Node **24.15.0**, pnpm **12.3.4**, `playwright-cli` **0.1.11**, macOS arm64. The grader used **gpt-5.6-luna**, AI SDK **7.0.93** and direct `@ai-sdk/openai` **4.0.60**.

## Applicability and retained debugging evidence

The real docs-only trial `smoke-docs-only-enabled-2026-09-07T20-35-49-076Z` completed in about **87 seconds**, using **102,017** observed Pi tokens. Its outcome passed and browser judgments were correctly **not-applicable**. It used no API grader: **$0 direct API cost**. Offline regrading with the final 1.4.0 grader preserved these judgments. This earlier trial has different harness/resource provenance and is not mixed into the final comparison.

Earlier UI attempts are retained rather than rewritten:

| Enabled trial suffix |          Bound | Observation                                                                                                                                       |
| -------------------- | -------------: | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `19-24-30-967Z`      |  80,000 tokens | Budget exceeded during setup/early editing after sandbox Git runtime errors; compliance unknown.                                                  |
| `19-28-12-330Z`      |  80,000 tokens | Copy, agent lint/build succeeded; budget exceeded while learning browser CLI usage; compliance unknown.                                           |
| `19-31-56-784Z`      | 120,000 tokens | Copy and browser checks succeeded; budget exceeded later during Git checks. Offline browser regrade passes; interruption status remains.          |
| `19-48-42-163Z`      | 300,000 tokens | Completed; outcome, browser compliance and browser behavior pass with the final offline grader. Original live semantic clarity passed separately. |

These directories begin with `smoke-ui-copy-enabled-2026-09-07T`. The first three used Node 26; subsequent verification uses the repository’s Node 24. Different bounds, runtimes and harness versions make these debugging evidence, not matched experiments. Explicit retry links retain that history.

The live traces exposed two useful evidence cases: a narrow literal `open URL && snapshot` pair, and a snapshot file deleted after successful validation. Both now have minimized offline regression coverage. Command mentions, automatic `open` snapshots, screenshots, evaluator checks, conflicting artifacts and arbitrary shell wrappers cannot earn a pass.

## Review and maintainability work

Independent architecture, evidence and DX reviews were followed by implementation and regression checks. The resulting package has:

- A thin CLI with command-specific help, task/profile discovery, offline validation and dry runs, progress, human/JSON output, run history and explicit grading-revision selection. Adding a task needs a JSON file, not a source registry edit.
- Separate trial orchestration, pure graders, native Pi transport/evidence translation, filesystem persistence, API grading and focused environment components. Typed tool receipts keep native output parsing out of domain graders.
- Original evidence integrity checks and separately sealed regrades. A damaged appended revision is visible and recoverable without weakening original integrity checks or silently selecting an earlier favorable result.
- Graceful cancellation through setup, Pi and semantic grading. A real SIGINT in an offline CLI integration test finishes cleanup and seals a cancelled regrade before exit 130, retaining the completed Pi trial. Unknown interrupted API usage is not reported as free.
- Native resource winner/scope preservation, source drift rejection and verification through Pi’s own resolver under the isolated HOME. Complete copied skill trees, including helpers and file modes, contribute stable comparison fingerprints.
- Native locked credential refresh before creating a private selected-provider copy. Refreshes persist normally in Pi’s original store; disposable credentials cannot discard rotated refresh tokens. Private copies are removed during cleanup.

The actual implementation worktree is **untrusted** in native Pi. It therefore selects **four user skills** and suppresses project skills/packages. The trial preserves that selected inventory; it does not resurrect repository skills. The synthetic fixture is trusted to activate the deliberately copied resources, and that difference is explicit in provenance. Saved source trust and model settings remain unchanged. Optional extension/package code, including normal auto-caveman injection and subagent behavior, remains suppressed in the controlled profile. These results describe that profile and a synthetic Wedding fixture, not the full production application or every part of daily Pi use.

## Checks actually run

- **204 offline tests passed**, covering RPC framing/completion, usage and failure handling, evidence attribution, adversarial mechanical traces, typed receipts, skill loading, resource selection, comparisons, integrity/recovery, API grading and cancellation.
- Package typecheck, dedicated oxlint and Prettier checks passed. Root application lint and Next.js production build passed with Node 24.
- Actual CLI help, catalogs, validation, missing-key dry runs, caller-relative paths, JSON output, saved-result inspection, offline regrading and matched comparison were exercised.
- The explicit native preflight passed sandboxed Git, pinned pnpm lint/build, file edits, native `playwright-cli open` and `playwright-cli snapshot`. It verified resource discovery and cleanup without a model call. Environment checks remain separately attributed and cannot earn agent compliance.
- The final audit scanned **3,322 evidence/workspace files across 20 retained trial/preflight roots**: **zero grader-key matches**, **zero private Pi auth/model copies**, **zero live registered process groups** among 642 recorded groups, and all seven trial service ports closed. No trial recorded a cleanup error. The boundary also has outside-file, symlink/write escape and external-network checks.

## API cost

| Direct OpenAI activity                                      | Estimated cost |
| ----------------------------------------------------------- | -------------: |
| Initial standalone grader smoke and four earlier UI graders |     $0.0013814 |
| Final enabled trial · 931 input / 91 output tokens          |     $0.0002954 |
| Final disabled trial · 931 input / 120 output tokens        |     $0.0003302 |
| **Total: seven grader calls**                               | **$0.0020070** |

The final pair added **$0.0006256**. Pi ran on verified Codex OAuth subscription authentication, so its catalog estimates are retained for audit and excluded from the API dollar allowance. No broad matrix or automatic retry ran.

The profile retains one trial at a time, 300,000 observed cumulative tokens, 300 seconds and zero automatic retries. Luna is limited to 18,000 input characters, 800 output tokens, 20 seconds and zero retries, with a conservative **$0.00456** reservation against a **$1 estimated API allowance per invocation**. No expensive model fallback is configured. These are application estimates, not provider-enforced caps or an account-balance claim. All seven API calls returned usage; none had unknown cost.

Semantic calibration cases remain **pending human labels**. Valid structured output, citations and successful live calls do not establish human agreement. Mechanical grading and the matched comparison work independently of that review.

## Local evidence and next commands

- [Final enabled report](runs/smoke-ui-copy-enabled-2026-09-07T21-01-54-738Z/report.md), [manifest](runs/smoke-ui-copy-enabled-2026-09-07T21-01-54-738Z/manifest.json) and [evidence](runs/smoke-ui-copy-enabled-2026-09-07T21-01-54-738Z/evidence.json)
- [Final disabled report](runs/smoke-ui-copy-disabled-2026-09-07T21-04-58-174Z/report.md)
- [Matched comparison report](runs/comparison-2026-09-07T21-07-15-789Z/report.md)
- [Docs-only report](runs/smoke-docs-only-enabled-2026-09-07T20-35-49-076Z/report.md) and [final offline regrade](runs/smoke-docs-only-enabled-2026-09-07T20-35-49-076Z/regrade-2026-09-07T21-02-27-723Z.md)
- [Earlier completed UI trial, final offline regrade](runs/smoke-ui-copy-enabled-2026-09-07T19-48-42-163Z/regrade-2026-09-07T20-54-57-139Z.md)
- [Native tool preflight](runs/native-tools-preflight/observations.json) and [final cleanup/secret audit](runs/final-audit.json)

These links are intentionally local; generated evidence is not committed. Inspecting them incurs no new model cost:

```bash
pnpm evals show smoke-ui-copy-enabled-2026-09-07T21-01-54-738Z
pnpm evals compare smoke-ui-copy-enabled-2026-09-07T21-01-54-738Z smoke-ui-copy-disabled-2026-09-07T21-04-58-174Z
pnpm evals help run
```

See [setup and commands](README.md), [adding an evaluation](authoring.md) and [package architecture](../tools/agent-evals/README.md). The focused next candidate remains `diagnose`: natural activation positives, near-miss negatives and a separate explicitly loaded execution suite. Establish its intended native trust/profile first. Repeated scheduling, a shared API spend ledger, human calibration and opt-in live CI are documented future work.
