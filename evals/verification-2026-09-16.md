# Real-repository verification — 16 September 2026

This revises the original synthetic-page demonstration after skeptical review of PR #131. The primary tasks now run against Wedding Planner commit `30d2388f71595d1ba65d0d2fabc8b97b6ee48f80`, including its actual TypeScript/React login form and Next.js runtime. Synthetic tasks remain regression fixtures. The original checkout is unchanged.

## Verified without model calls

- `pnpm check:evals`: typecheck, lint and formatting passed.
- `pnpm test:evals`: 244 offline tests passed. Coverage includes a second grader, a second harness composition, shared live/regrade judgments, retained failures, comparison factors and adversarial browser evidence.
- `pnpm evals validate`: all five tasks and two profiles passed configuration validation.
- `pnpm --dir tools/agent-evals exec tsx test/repository-native-smoke.ts`: the seeded invisible login error failed browser acceptance. Removing its `hidden` class made the same acceptance pass. Required inputs, empty-submit validation, disabled pending state, exactly one real Server Action POST, visible error feedback and absence of browser page errors were checked.
- Final independent acceptance ran the actual `pnpm lint` script, including ESLint and nested oxlint, and `pnpm build --webpack`. Both passed; source inventory remained unchanged by evaluator commands.
- The native browser probe captured an explicit `playwright-cli snapshot`. It is attributed to the evaluator and earns no agent-compliance credit.
- Agent tools could neither read the private acceptance script nor modify installed dependencies.

The [reviewed red/green extract](examples/repository-preflight/README.md) includes the actual repair patch, check statuses and runtime/source hashes. It contains no agent result and makes no instruction-usefulness claim.

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
