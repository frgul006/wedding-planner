# Real repository acceptance probes

These are reviewed extracts from the September 16 local probes, not agent trials. Both ran the pinned Wedding application and made **zero model calls**.

The error-repair case hid the real login error with a CSS class. Browser acceptance failed while waiting for the alert to become visible. After the one-line repair in [repair.patch](repair.patch), the same check passed. The copy case rejected the original button label and passed after the one-line change in [copy.patch](copy.patch).

Both cases passed required input validation, exactly one login Server Action request, pending behavior and visible failure feedback. The actual `pnpm lint` command passed both ESLint and oxlint; `pnpm build --webpack` passed the production Next.js build. The probe also verified that an agent-generated cache marker was removed before independent acceptance.

[observations.json](observations.json) records the error-repair case; [observations-ui-copy.json](observations-ui-copy.json) records the copy case. Each retains the actual statuses, browser assertions, runtime versions, pinned and installed dependency-lock hashes, source hashes and original recording fingerprint. Private absolute paths and complete local logs are omitted.

The September 27 retry probe uses `repository-login-retry`: its seed incorrectly keeps the submit button disabled after a failed sign-in. The unchanged fixture failed at that transition. After restoring pending-only disabling, two real local Server Action attempts passed required-input, pending-state, retry and visible-error checks. The probe exercised both attempts with `playwright-cli run-code` and captured an explicit `playwright-cli snapshot` showing the error and enabled sign-in button. Independent lint, build and browser checks passed. Its local recording is `evals/runs/repository-native-preflight/observations-login-retry.json`; this was an evaluator repair with no model calls.

Task version 2 also permits `e2e/admin-login-retry.spec.ts` so an agent can add a dedicated reproduction and regression test instead of extending the existing smoke test. The change scope remains limited to those two test paths and the login form. Saved version 1 trials retain their original task definition and grades; this adjustment does not reinterpret their outcomes.

The isolated runtime uses webpack for development and production builds. Default Turbopack requires process and port access outside this boundary; trial agents receive the supported build command in their recorded environment context. Dependencies are copied privately and kept read-only. The evaluator verifies the installed application lock against the pinned source lock, then disables pnpm's copied-path dependency reinstall check.

Reproduce from the repository root after the live environment prerequisites are installed:

```bash
pnpm --dir tools/agent-evals exec tsx test/repository-native-smoke.ts
# Run only the retry transition probe:
EVAL_TASKS=repository-login-retry pnpm --dir tools/agent-evals exec tsx test/repository-native-smoke.ts
```

These probes validate the acceptance cases. They do not show Pi following an instruction or establish instruction usefulness. Authentication failure uses an unavailable loopback endpoint; successful authentication and database behavior are outside these cases. A prior live copy trial's browser acceptance timeout remains preserved in its original recording. Four unchanged reruns passed; its cause was not established. Fresh-cache acceptance protects independence but is not a proven causal explanation for that timeout.
