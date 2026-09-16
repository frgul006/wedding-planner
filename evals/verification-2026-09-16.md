# Real-repository verification — 16 September 2026

This revises the original synthetic-page demonstration after skeptical review of PR #131. The primary tasks now run against Wedding Planner commit `30d2388f71595d1ba65d0d2fabc8b97b6ee48f80`, including its actual TypeScript/React login form and Next.js runtime. Synthetic tasks remain regression fixtures. The original checkout is unchanged.

## Verified without model calls

- `pnpm check:evals`: typecheck, lint and formatting passed.
- `pnpm test:evals`: 245 offline tests passed. Coverage includes a second grader, a second harness composition, shared live/regrade judgments, retained failures, comparison factors, pinned browser selection and adversarial browser evidence.
- `pnpm evals validate`: all five tasks and two profiles passed configuration validation.
- `pnpm --dir tools/agent-evals exec tsx test/repository-native-smoke.ts`: the seeded invisible login error failed browser acceptance. Removing its `hidden` class made the same acceptance pass. Required inputs, empty-submit validation, disabled pending state, exactly one real Server Action POST, visible error feedback and absence of browser page errors were checked.
- Final independent acceptance ran the actual `pnpm lint` script, including ESLint and nested oxlint, and `pnpm build --webpack`. Both passed; source inventory remained unchanged by evaluator commands.
- The native browser probe captured an explicit `playwright-cli snapshot`. It is attributed to the evaluator and earns no agent-compliance credit.
- Agent tools could neither read the private acceptance script nor modify installed dependencies.

The [reviewed red/green extract](examples/repository-preflight/README.md) includes the actual repair patch, check statuses and runtime/source hashes. It contains no agent result and makes no instruction-usefulness claim.

## Live matched instruction pair

```bash
pnpm evals experiment repository-ui-copy --semantic --budget-usd 0.02
```

Experiment `experiment-repository-ui-copy-2026-09-16T08-17-20-921Z` completed both trials with matching comparison conditions. It ran against the frozen evaluator in commit `a0e1b7b` with task version 2. The later temporary-directory portability fix affects Linux filesystem tests and leaves the macOS runtime path unchanged.

| Instruction | Agent execution | Task outcome | Independent acceptance | Diff scope | Browser behavior  | Browser compliance | Semantic clarity |
| ----------- | --------------- | ------------ | ---------------------- | ---------- | ----------------- | ------------------ | ---------------- |
| Enabled     | Completed       | Pass         | Pass                   | Pass       | Pass              | Pass               | Pass             |
| Disabled    | Completed       | Pass         | Pass                   | Pass       | Fail: no snapshot | Not applicable     | Pass             |

See the [reviewed live example](examples/repository-ui-copy/README.md) for exact retained patches, the enabled agent's explicit snapshot, receipt facts and the generated pair summary. The disabled agent attempted browser validation twice with `@playwright/test`: a module-syntax error stopped the first script, and the corrected script could not launch Playwright's expected browser from the isolated home cache. [Reviewed attempt receipts](examples/repository-ui-copy/disabled-browser-attempts.json) retain event IDs, statuses and source hashes. The observed difference is successful required snapshot capture, not a choice to omit validation; the alternative browser path encountered a runtime limitation. Snapshot compliance was not applicable without that instruction. Both real application outcomes passed the same independent checks.

The two Luna calls cost an estimated **$0.0013672**, using conservative uncached input rates. Including the earlier completed diagnostic call ($0.0008162), the three new direct grader calls total **$0.0021834**. The interrupted diagnostic condition was cancelled before grading dispatch. No expensive fallback or SDK retry occurred. Pi used its subscription with separate usage accounting.

Subsequent review traced the disabled trial's launch failure to the omitted `PLAYWRIGHT_BROWSERS_PATH` in the isolated environment. The final adapter exposes that cache location, selects the exact Chromium revision required by the installed application Playwright package, and keeps filesystem access restricted to that browser installation. `pnpm --dir tools/agent-evals exec tsx test/playwright-package-native-smoke.ts` verified a default `@playwright/test` launch against the actual login page and denied listing the cache root. It made no Pi or API call. The historical pair predates this fix and retains its original limitation; no new matched pair was run after the change.

## Documentation and configuration comparison

```bash
pnpm evals run repository-docs --profile smoke --no-grader
pnpm evals run repository-docs --profile controlled --no-grader
pnpm evals compare trial-repository-docs-enabled-2026-09-16T08-27-05-322Z \
  trial-repository-docs-enabled-2026-09-16T08-30-33-960Z --factor agent-configuration
```

Both documentation trials completed on evaluator commit `291b7d3`, changed only `docs/admin-auth.md`, and passed target, independent acceptance and change-scope checks. Both browser judgments were correctly not applicable. The native trial recorded 230,274 cumulative Pi tokens; the controlled trial recorded 279,411. Neither made a grader API call.

Comparison `comparison-2026-09-16T08-34-13-633Z` was eligible with no condition mismatches. Both kept the instruction enabled; the declared factor was native conversation settings versus disabled compaction/retries. These runs exercise configuration comparison and documentation applicability, not the quality of the documentation or the effect of compaction/retries on reliability.

## Retained live repair failure

```bash
pnpm evals run repository-login-error --no-grader
```

Trial `trial-repository-login-error-enabled-2026-09-16T08-34-15-292Z` ended with `agent_error` after a WebSocket closure, one native Pi provider retry, and the provider response `{"detail":"Bad Request"}`. It recorded 139,125 cumulative Pi tokens, made no source changes and incurred no grader API call. Lint, production build and source stability passed; browser acceptance rejected the still-hidden error, as intended. Both agent browser judgments were `unknown` because execution ended before successful validation.

This is a retained failed live trial, not a successful repair. Its underlying provider error has not been diagnosed. The separate no-model red/green preflight proves that acceptance rejects the seeded defect and accepts the one-line repair; it does not substitute for a successful live agent repair. No automatic trial rerun or replacement result was used.

Read-only cleanup audits of the UI pair, documentation pair and failed repair found private authentication/configuration files absent, no processes with the recorded workspace command line or working directory, and closed service ports. Original recording seals remained valid. The ignored audit files are under `evals/runs/audit-2026-09-16`. These are post-run observations; the emptied process registry is not a complete historical process trace.

## Configuration and limits

Pi inspection used the original checkout's actual trusted project, with 17 discovered skills and its saved `openai-codex/gpt-5.5/xhigh` OAuth subscription configuration. The default preserves native conversation settings, including compaction and provider retries. The controlled comparison disables those two settings. Neither profile enables arbitrary optional extension tools or subagents; both use the isolated `read`, `bash`, `edit`, `write` surface. This does not establish full parity with the user's interactive extension setup.

Each trial allows 15 minutes and 1.5 million observed cumulative Pi tokens. Those are subscription usage bounds, separate from the grader API allowance. Native provider retries remain inside the same outer bounds; there is no automatic trial retry. Unreported usage remains unknown.

The application uses local placeholders and an unavailable loopback auth endpoint. Browser acceptance verifies real form rendering/submission/failure behavior, not successful authentication, database integration or broader wedding workflows. Offline Google-font responses use system fallbacks. Development and production checks use webpack; the default Turbopack build requires process/port access outside this boundary. The supported `pnpm build --webpack` command is disclosed to the agent in recorded runtime context.

The evaluator verifies the pinned repository lockfile against both the dependency source checkout and its installed application lock before making a private dependency copy. It then disables pnpm's automatic dependency reinstall for the copied path. This is the supported [`verifyDepsBeforeRun` setting](https://pnpm.io/settings/build#verifydepsbeforerun), not an application-source modification or permission to download dependencies.

## Retained diagnostic attempt

The first real UI experiment, `experiment-repository-ui-copy-2026-09-16T08-00-25-777Z`, exposed defects in the evaluator itself. Pi completed the requested label change and updated corresponding test locators. The target-only scope rule incorrectly rejected that reasonable maintenance. The browser grader also compared an explicit snapshot against the earlier automatic navigation snapshot, whose transient Next.js alert differed after hydration. Independent browser acceptance then timed out despite a correct component patch; the retained workspace passed the same check on investigation.

The experiment was stopped while the second condition was running. Both recordings and the incomplete experiment were preserved. This attempt is diagnostic evidence, not a successful matched comparison. Task version 2 allows the relevant existing test files, and later runs use the corrected checks and more explicit runtime context. Original results remain sealed. An appended offline regrade with browser grader 1.6.0 passes both browser judgments on the unchanged first recording, with no new Pi or API call. The original unknown judgments remain available.

## Interpretation

A matched pair demonstrates observations and checks the experimental machinery. It cannot estimate reliability, establish instruction usefulness or show that an instruction is unnecessary. Mechanical browser judgments and independent application acceptance remain separate. Semantic grading is provisional and still needs human calibration; documentation checks establish required-section presence rather than deep correctness. Optional browser use on a docs task is not a violation.

Only Pi has a live harness implementation. Offline tests establish the second-harness composition seam; a real second backend still needs its own configuration, diagnostics and isolation adapter. The focused next research slice remains natural `diagnose` activation positives, near-miss negatives and separate explicit skill-execution cases.
