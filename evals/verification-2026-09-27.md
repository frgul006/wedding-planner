# Library workflow verification — 27 September 2026

This verifies the portable library and saved-evidence workflow on `codex/agent-evals`. It does not measure semantic judge accuracy or instruction benefit.

## Runtime and credentials

The worktree contains a nonempty `TYPESAFE_API_KEY` in its ignored `.env.local`; only that key is loaded for Jev. It was not printed, copied into Pi, or included in staged changes. Native Pi is 0.87.1, using `openai-codex/gpt-6-luna` with saved `xhigh` reasoning and existing subscription authentication. Global model, reasoning, endpoint configuration and authentication remain unchanged by profile selection.

The first saved attempt, `run-1790520564510-cd235949-8d24-40bc-a1e9-7bc1bd9f66a7`, failed before generating tokens. Pi's provider-wide endpoint override pointed to a local Python static-file server, which rejected the model POST with HTTP 501. Its trial and unknown grades remain saved. The explicit `catalog` endpoint policy then passed native readiness; it removes only an endpoint-only override in the private trial configuration and checks the selected endpoint before prompting.

## Independent fixture check

The seeded login-retry defect disables the submit button after the first failed local login. The zero-model red/green probe rejected this implementation and accepted a repair. It exercised two real local Server Actions, required-input blocking, pending feedback, visible errors, fresh lint/build, and source stability. The changed-flow `playwright-cli snapshot` is retained in `evals/runs/repository-native-preflight/observations-login-retry.json` under `snapshot.stdout`.

This local failure path uses no production authentication service. It does not verify successful sign-in or database behavior.

## Native Luna observation

The deliberate repeat after the endpoint repair is `run-1790521178864-ca271717-5a9f-4812-9681-f0148d0019f9`, containing trial `trial-1790521178864-2b7e6765-8dfb-4c57-b40d-b0f3fcec1e79`.

The agent reproduced the disabled retry button, stated ranked hypotheses, wrote a regression test, and encountered a failed pending-feedback assertion before reaching the retry assertion. It hit the configured 350,000 cumulative-token boundary during the next edit, before repairing the target. Observed usage was 43,906 input, 8,737 output, and 310,272 cached-input tokens: 362,915 in total, including the allowed in-flight overshoot. Pi's catalog-based cost estimate was $0.01186182; this is not a separate invoice for subscription usage.

Independent lint/build passed; independent browser acceptance failed because retry remained broken. The original diagnostic and final-validation grades are unknown because the recording ends with an unfinished tool call and no settled agent boundary. The saved trial remains unchanged. A failed or interrupted attempt is retained rather than replaced with a passing result.

## Authored Jev transport check

The separate authored fixture `authored-jev-smoke-1790520432621-ffd1bb82-5aec-4480-8973-96e5c931092b` produced two Jev requests, each with two questions sharing one evidence state. Initial grading used 1,189 input tokens; a changed-question regrade used 1,197. Both responses resolved to pinned `jev-1.13.0`, with 150 total output tokens and a combined estimate of $0.000100212. The original fixture bytes and both grading records were retained.

This fixture explicitly labels its dialogue and observations as authored. It proves provider transport, batching, storage and regrading, not real agent behavior or judge accuracy.

## Native evidence grading and regrading

The explicit `completedDiagnosis@1` view audits the completed prefix through native turn `e01729`. It retains the visible hypothesis and all eight following tool actions through the first completed regression attempt, including its authored test source and failed output. Both independent reviewers verified that its one line-encoded output reconstructs the original exactly. Earlier exploration text and later activity are declared omissions; the parent trial remains incomplete. This scope does not establish eventual repair or trial-wide compliance.

Two real Jev calls then graded this same saved native evidence:

| Grading                                                      | Hypothesis question                                | Shared questions | Input / output tokens | Estimated cost |
| ------------------------------------------------------------ | -------------------------------------------------- | ---------------- | --------------------- | -------------- |
| `grading-1790522451282-01232641-c974-4c86-8017-4b75d4062d75` | Version 1                                          | 2 in one request | 9,796 / 75            | $0.000411432   |
| `grading-1790522490750-e5041f9a-e588-4fe6-9164-1267aada7791` | Version 2, requiring a prediction before the probe | 2 in one request | 9,813 / 75            | $0.000412146   |

Both responses resolved to `jev-1.13.0`. Jev returned `pass` for both scoped questions in both records; deterministic final validation remained `unknown`. These are provisional model judgments: the actual regression failed before the retry assertion, so the scores must not be read as proof of a successful test or repair. Human calibration remains necessary.

The exact submitted state was identical across the two requests; the revised question and its version were recorded separately. The original trial file retained SHA-256 `7e6978bde856ed8e6e338b3b86a54ce901d2b87995c5d8c3063f619a39b3c2b3`, both prior grades remain available, and the native attempt count stayed at two (the transport failure and the bounded actual attempt). No Pi process was launched by either regrade. Combined native-evidence Jev estimate: $0.000823578. Including the authored smoke, all four Jev requests cost an estimated $0.00092379.

Readable reports and exact requests/responses are retained in `evals/runs/library/gradings/GRADING_ID/`. Reproduce inspection with `pnpm evals library show run-1790521178864-ca271717-5a9f-4812-9681-f0148d0019f9`; use the explicit `--diagnosis-scope completed-attempt` flag when regrading this bounded recording.

## Review and checks

Repeated independent reviews found and fixed mutable definition/storage races, lost malformed responses and usage, under-reserved observed cost, final-artifact selection, actor-mismatched tool results, non-verifying commands earning validation credit, and misleading CLI exit statuses/previews. A further review checked scoped prefix boundaries, missing or misclassified observations, lossless output reconstruction and exact request admission. All material implementation findings were resolved and reviewed again. Human calibration remains a stated research limitation.

Final local checks passed all 368 offline tests and evaluation type/lint/format checks. Application lint and the production webpack build passed. The first pushed checkpoint also passed all GitHub CI checks including the E2E shards; the final PR checks are tracked separately on the pull request.

Private native recordings and grading reports remain under ignored `evals/runs/`. Public documentation reports observations and limitations without publishing the user's complete native context.

## Per-trial budgets and completed native follow-up

The subsequent budget revision removes the hidden library ceilings and the former profile maxima. Defaults are now one hour of agent execution, 500 completed native turns, and 5,000,000 weighted tokens per trial. Profiles, task definitions and explicit per-run overrides can configure each field. Any reached limit requests an abort; the first cause, threshold and observed counter are retained. Cached reads and writes count at 0.1, with raw usage preserved. Task and run configuration are copied before asynchronous preparation.

A fresh `pnpm evals library run --no-judge --json` completed under those defaults:

- Run: `run-1790523735196-5f5a2e66-3865-495a-a95c-e5ff98658fed`
- Trial: `trial-1790523735196-ed20e63b-78c6-4dff-9a81-8c371dbf4e0d`
- Native agent: Luna with the same saved `xhigh` reasoning and subscription authentication.
- Agent status: `completed`, with a complete trace and no capture gaps or limit hit.
- Agent elapsed time: approximately 10 minutes 20 seconds, from 15:42:47 to 15:53:07 UTC.
- Turns: 38 started and completed.
- Raw usage: 75,141 input, 16,711 output, 1,272,320 cached input, and zero cached writes; 1,364,172 tokens total.
- Weighted usage: **219,084 tokens**, calculated as `75,141 + 16,711 + 0.1 × 1,272,320`.
- Independent evaluator lint, build, login-retry browser acceptance and acceptance-source-stability checks: all passed.
- The agent's saved changes affect the login form and its regression test inside the disposable trial checkout; they do not replace the seeded fixture in this branch.

The deterministic `validation-after-final-edit` grader returned `unknown` in `grading-1790524414236-9e500784-5b5f-453a-a3d8-9a90ce834ee6`. Four unsupported verification command forms prevented full coverage of that behavioral check. This conservative attribution result is separate from the successful independent acceptance checks and complete agent execution. No Jev requests were made for this follow-up.

Independent budget reviews and regression tests cover field precedence, raising limits beyond the former ceilings, independent counters per trial, runtime/turn/token stopping, late-reported usage, delayed timer callbacks, configuration mutation and backward-compatible saved records. A final reporting correction freezes the agent runtime counter at settlement or the first stop; final statistics retrieval and process shutdown remain part of the overall runner timestamps, not the execution budget. This changes reporting only for the successful follow-up above, whose duration is far below the configured limit.

After that correction, all **389 offline tests** and evaluation type/lint/format checks pass. Independent reviewers rechecked configuration snapshots, precedence, stopping conditions and elapsed-time reporting. The first budget commit also passed all GitHub checks, including lint/build, all five E2E shards and the regression aggregation.

## Offline browser-command regrade

The completed trial above was regraded with `pnpm evals library regrade run-1790523735196-5f5a2e66-3865-495a-a95c-e5ff98658fed --no-judge --json`. The new record is `grading-1790527668484-92f7dbb1-fb4c-4ead-9e4b-d8bf76de42ee`, using `validationHistory@4` and `validation-after-final-edit@3`. Its deterministic verdict is **pass** for the declared lint, build and browser-snapshot requirements, with complete recording coverage.

The view recognizes the four literal browser command chains and verifies their native call/result pairs, exact captured output hashes, final explicit inline snapshots and target revision. The final browser evidence is call/result `e04224`/`e04230`, captured output `artifact-13` and final source `artifact-1`. The snapshot is derived from that command's retained output; an earlier automatic snapshot file is not substituted. Earlier failures and pre-edit observations remain visible.

Broader invocation detection also exposes four environment-prefixed Playwright test commands (`e01142`, `e01325`, `e03632`, `e03929`). They remain explicitly listed as unsupported `test` syntax with call/result references. Tests are outside this task's declared behavioral requirements, so those commands do not determine this verdict. Unsupported commands that could affect a required check, or whose possible check kinds cannot be established, still yield `unknown`. This pass does not claim that every recorded command is supported or that every test attempt succeeded.

No Luna or Jev calls were made for the offline regrades. The final record has zero judge requests and jobs. All 28 pre-existing files checked before the final regrade—including the native recording, portable trial/run, original unknown grade and intermediate grading records—retained their exact hashes. The native trial-directory inventory also stayed unchanged. The portable trial file remains SHA-256 `5f2b72a4adab2398ca8b878a239d837f7bf2bc839a215a6f1d75b7a75f4d02f3`; its canonical content hash is `ae0be843905676752cb03336cfa6b6b61bebc8d9ecdea25fe428607f2c5ff39b`. The final grading file is SHA-256 `cdaa5ebb7bd6c08bd9197e7ec9466386ef6445636c3423dd08a35c29546dde36`. The successful trial's usage, duration and 38-turn count are unchanged.

Repeated independent reviews found and corrected omitted later commands, CLI flag interpretation and overly broad unknown attribution. All **413 offline tests** pass, including command grammar, native provenance, altered or missing capture, final-snapshot pairing, later failure/edit ordering, wrapper ambiguity and required-check scope. Evaluation type, lint and formatting checks pass. These are harness-only changes; the independent application acceptance results above are unchanged.
