# Real repository acceptance probes

These are reviewed extracts from the September 16 local probes, not agent trials. Both ran the pinned Wedding application and made **zero model calls**.

The error-repair case hid the real login error with a CSS class. Browser acceptance failed while waiting for the alert to become visible. After the one-line repair in [repair.patch](repair.patch), the same check passed. The copy case rejected the original button label and passed after the one-line change in [copy.patch](copy.patch).

Both cases passed required input validation, exactly one login Server Action request, pending behavior and visible failure feedback. The actual `pnpm lint` command passed both ESLint and oxlint; `pnpm build --webpack` passed the production Next.js build. The probe also verified that an agent-generated cache marker was removed before independent acceptance.

[observations.json](observations.json) records the error-repair case; [observations-ui-copy.json](observations-ui-copy.json) records the copy case. Each retains the actual statuses, browser assertions, runtime versions, pinned and installed dependency-lock hashes, source hashes and original recording fingerprint. Private absolute paths and complete local logs are omitted.

The isolated runtime uses webpack for development and production builds. Default Turbopack requires process and port access outside this boundary; trial agents receive the supported build command in their recorded environment context. Dependencies are copied privately and kept read-only. The evaluator verifies the installed application lock against the pinned source lock, then disables pnpm's copied-path dependency reinstall check.

Reproduce from the repository root after the live environment prerequisites are installed:

```bash
pnpm --dir tools/agent-evals exec tsx test/repository-native-smoke.ts
```

These probes validate the acceptance cases. They do not show Pi following an instruction or establish instruction usefulness. Authentication failure uses an unavailable loopback endpoint; successful authentication and database behavior are outside these cases. A prior live copy trial's browser acceptance timeout remains preserved in its original recording. Four unchanged reruns passed; its cause was not established. Fresh-cache acceptance protects independence but is not a proven causal explanation for that timeout.
