# Record, inspect and regrade coding-agent trials

The evaluation library records an agent attempt once, prepares evidence for specific questions, and lets you revise those questions against the same saved recording. A Runner executes tasks, Views prepare evidence, Graders define checks, a Judge answers model questions, and a Store retains trials and grading records. Task correctness, instruction compliance, and instruction usefulness are separate claims.

[Package architecture and development checks](../tools/agent-evals/README.md) · [Architecture decision](../docs/adr/0004-agent-evaluation-boundary.md)

## Run the example

Use Node 24 and this repository's pnpm version. Live execution requires macOS, native Pi with `gpt-6-luna` in the authenticated provider catalog, `playwright-cli`, and the Chromium headless shell required by the application's Playwright package. Dependencies matching the task's pinned Wedding commit must already be installed in the original checkout; trials copy them privately without downloading packages. `COREPACK_HOME` and `PLAYWRIGHT_BROWSERS_PATH` support nonstandard tool caches.

Keep `TYPESAFE_API_KEY` in this worktree's ignored `.env.local`. The CLI reads only that key for Jev; `--key-file PATH` selects another file. Pi uses its existing subscription authentication separately. Application credentials and the Jev key do not enter the evaluated agent's environment.

```bash
nvm use
pnpm install
pnpm evals library run --dry-run
pnpm evals library run
pnpm evals library show RUN_ID
pnpm evals library regrade RUN_ID --revision 2
```

`run` makes one isolated native Luna attempt at `repository-login-retry`, saves the recording, and applies two diagnostic Jev questions plus a deterministic validation-order check. The natural task asks Pi to investigate and repair a login form that remains stuck after an unsuccessful submission, without naming a skill or giving away the cause. Independent acceptance exercises two actual local Server Actions, required-input validation, pending state, and error feedback.

`show` reads local records. `regrade` appends results for the same saved trial without starting Pi; revision 2 sharpens the hypothesis question to require a refutable prediction before the probe. `--no-judge` selects only the deterministic grader. `--dry-run` previews configuration without credentials or calls, and `--json` produces machine-readable output. `--store PATH` changes the library store. Options that do not apply to the selected command are rejected. Judge options (`--key-file`, `--budget-usd`, `--revision`, `--diagnosis-scope`) cannot be combined with `--no-judge`. Use the returned run ID with `show` and `regrade`; see `pnpm evals library --help` for all options.

Trial execution status and behavioral verdicts are separate. CLI exit code 1 means command setup or storage failed, such as invalid configuration, a missing key, or an unreadable saved record. Exit code 2 means a recorded trial's execution, preparation, or grading failed. A completed `fail` or `unknown` judgment is reported separately and does not change the exit code. Interrupted attempts remain saved. There is no automatic trial retry.

## Limits and native configuration

The defaults are **30 minutes, 100 completed turns, and 1,000,000 weighted tokens per trial**. Any reached limit stops that trial, and counters reset for each repetition. A turn is one assistant response plus its resulting tool calls/results, including failed attempts and native retries. Runtime includes Pi startup and agent execution, excluding environment preparation, final acceptance, and grading.

Token accounting is `input + output + 0.1 × (cacheRead + cacheWrite)` across all calls. Raw provider usage remains unchanged. The first observed limit hit, its threshold, and the observed counter are recorded; usage may overshoot while a response is in flight. Reaching a boundary is an incomplete trial even if it coincides with an otherwise final response. Process shutdown and final accounting do not extend the execution-time counter.

```bash
pnpm evals library run --max-runtime-ms 1800000 --max-turns 100 --max-tokens 1000000 --dry-run
```

Limits resolve field by field: shared defaults, profile values, Pi runner defaults, task limits, then explicit per-trial overrides. CLI flags override task values. Profiles, TypeScript tasks, and task JSON use the same `limits: { runtimeMs, maxTurns, maxTokens }` object. Omitted fields inherit. Values must be positive safe integers, and runtime must fit Node's timer range (2,147,483,647 milliseconds). The environment and authentication deadlines receive the same resolved runtime; a longer OAuth trial fails preparation if credentials cannot remain valid long enough.

The `smoke` profile selects `gpt-6-luna` and preserves the saved provider, reasoning, compaction, and native retry settings without changing global Pi settings. An unavailable model or incompatible reasoning level fails before prompting; there is no model fallback.

The profile selects `pi.endpoint: "catalog"`. The adapter removes only an endpoint-only override from the private Pi configuration and verifies the native catalog endpoint before prompting. Saved and effective endpoint identities are recorded. Complex custom credentials or model definitions are rejected rather than redirected. Omit the field or use `"native"` to retain a configured endpoint.

Pi resource discovery uses the original checkout's actual trust decision; `--agent-source PATH` explicitly selects another resource checkout. Instructions, skills, selected resources, and effective configuration are recorded with their hashes. Native Pi resolves copied instructions and skills before prompting. Trusted project-specific runtime overrides in `.pi/settings.json` are currently rejected rather than silently ignored.

The isolated tool surface is `read`, `bash`, `edit`, and `write`. Optional extension/package code and subagents are excluded, including automatic caveman injection. This configuration does not reproduce every extension in an interactive Pi session.

Jev uses pinned `jev-1.13.0`, concurrency one, a 20-second request timeout, and no SDK retries. The default aggregate admission allowance is $0.01 per command; `--budget-usd` changes it up to $1. These estimates are application controls, not provider-enforced spending caps. Pi subscription usage is separate from the judge allowance.

## Inspect the evidence

Private records live under ignored `evals/runs/`. The default library store is `evals/runs/library/`:

| Record                                         | Contents                                                                                                                                        |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `trials/TRIAL_ID.json`                         | Observable normalized trace, retained native source payloads, artifacts, historical instruction/skill contents, outcome, and runtime provenance |
| `runs/RUN_ID.json`                             | Trial and original grading IDs for a suite run                                                                                                  |
| `gradings/GRADING_ID/grading.json`             | Exact prepared evidence, source references, content hashes, versions, questions, request membership, responses, errors, and usage               |
| `gradings/GRADING_ID/report.md`                | Readable evidence, scope, omissions, verdicts, and judge request/response                                                                       |
| `gradings/GRADING_ID/requests/REQUEST_ID.json` | Credential-free exact request body journaled before dispatch                                                                                    |

The Pi adapter also retains its incremental native recording under `evals/runs/TRIAL_ID/`. Full command outputs are retained separately. Historical context comes from that recording, never today's files. Source references point into saved events, artifacts, and contexts; they do not give Jev access to content omitted from its request. Hashes detect accidental changes, not malicious rewriting. Stores refuse overwrites, and regrading preserves the trial and earlier grading records.

A request journal proves preparation, not successful dispatch. The completed grading record records dispatch attempts and their responses. `show` and `listGradings` list completed grading records; interrupted attempts retain their request journals under `gradings/GRADING_ID/requests/` for direct inspection without hiding earlier grades. Records may contain private paths and instruction text and should be reviewed before sharing.

## Views and verdicts

A View returns named evidence items with data, source references, scope, omissions, applicability, and coverage gaps. The engine prepares a shared View once per grading and saves its version and content hash. Empty Views and unresolved references are preparation errors. Missing required recording coverage yields `unknown`; observable omission of required behavior can yield `fail`; explicit inapplicability yields `not_applicable`.

The `diagnosis` View selects visible hypothesis windows using a lexical heuristic and retains subsequent tools and conversation, failures, contradictions, and the preceding tool result. If no hypothesis matches, it supplies the broader observable conversation and tools rather than asserting that diagnosis was absent. It does not submit hidden reasoning or all captured instruction/skill context. Selection can miss relevant context; a complete capture does not guarantee that a selected episode answers the question.

Two model graders ask whether the hypothesis is falsifiable and whether an actual probe tests it. A failed test can still be a relevant probe. Jev batches questions only when their complete submitted evidence envelopes match, including scope, source references, and coverage. Sharing a View name alone is insufficient. Requests contain explicit `pass`, `fail`, and `unknown` criteria and treat transcript content as untrusted evidence.

Jev returns categorical answers, probabilities, confidence, and usage. Reports retain these without inventing explanations or supporting quotations. Considered sources are distinct from explicitly supporting sources. Per-grader rollup is any fail, otherwise any unknown, otherwise any pass, otherwise not applicable. Several episodes from one trial are not independent agent attempts.

The deterministic `validationHistory` View checks agent-attributed validation after the final observed edit against the final target's fingerprint. Evaluator-owned acceptance and agent self-reports cannot earn agent-validation credit. Supported evidence includes literal lint/build/test commands, direct `playwright-cli snapshot` receipts, and literal browser chains joined with `&&` and ending in one explicit snapshot. Chain actions are `open`, `goto`, `fill`, `click`, and numeric `sleep`, all using one browser session. The chained path verifies native call/result correspondence and the exact retained output hash; an earlier automatic snapshot file cannot substitute for the final inline snapshot.

Unsupported commands remain visible. They block a verdict when they could affect a required check; uncertain command categories can affect every required check. Recording gaps, missing attestations, and unsupported syntax remain distinct reasons for uncertainty. Arbitrary shell execution is never promoted to proof of validation merely because it exits successfully.

### Regrade a completed diagnostic attempt

Oversized evidence is rejected without silent truncation. The usual Jev state limit is 18,000 characters, with additional conservative byte-based context checks. For an interrupted native trial, explicitly select a smaller, auditable scope:

```bash
pnpm evals library regrade RUN_ID --diagnosis-scope completed-attempt --revision 1
pnpm evals library regrade RUN_ID --diagnosis-scope completed-attempt --revision 2
```

`completedDiagnosis` selects the first visible hypothesis and every intervening tool action/result through the first literal test attempt's completed native turn. It audits continuity from native start, matching source payloads, paired calls/results, and recorded context fingerprints. For an interrupted trial, only specific terminal gaps proven to occur after that boundary are waived; other gaps and unfamiliar formats remain unknown.

Earlier tool contents, later activity (including later contradictions or repairs), and context text are explicitly omitted from the semantic input. The parent trial's status and gaps remain unchanged; trial-wide validation still sees the original incomplete recording. This is a judgment of the selected attempt, not of eventual repair.

Duplicate prompt/hypothesis text and redundant attachments are omitted from the request. Repeated output lines may use `line-dictionary-v1`, whose ordered references reconstruct the exact selected text, including empty lines and line endings. This is deterministic deduplication, not an AI-generated summary. The scoped CLI permits 30,000 state characters while retaining the same conservative context checks. Human calibration of this selection and representation remains outstanding.

## Author a suite

Use ordinary TypeScript functions; adding a Grader requires no registry or adapter change. Core and adapter imports are separate. This composition example assumes `task` contains a catalog-matching ID, version, and prompt, plus the metadata described below; `sourceRepo`, `agentSource`, and the privately loaded `typesafeKey` are supplied by the caller.

```ts
import {
  modelGrader,
  codeGrader,
  createEvaluator,
  type View,
} from "@wedding-planner/agent-evals";
import { piRunner } from "@wedding-planner/agent-evals/pi";
import { jevJudge } from "@wedding-planner/agent-evals/jev";
import { fileStore } from "@wedding-planner/agent-evals/files";
import {
  prepareDiagnosticEpisodes,
  validationHistory,
  checkValidationOrder,
} from "@wedding-planner/agent-evals/examples/diagnosis";

const diagnosis = {
  id: "diagnosis",
  version: 1,
  prepare: prepareDiagnosticEpisodes,
} satisfies View;
const hypothesis = modelGrader({
  id: "hypothesis",
  version: 1,
  view: diagnosis,
  question: "Does the visible hypothesis make a falsifiable prediction?",
  rubric: {
    pass: "Predicts an observable result whose opposite would disprove it.",
    fail: "The complete supplied conversation contains no such prediction.",
    unknown: "The supplied evidence cannot establish this.",
  },
});
const validation = codeGrader({
  id: "validation",
  version: 1,
  view: validationHistory,
  check: checkValidationOrder,
});
const evals = createEvaluator({
  runner: piRunner({ sourceRepo, agentSource }),
  judge: jevJudge({ apiKey: typesafeKey }),
  store: fileStore("evals/runs/my-suite"),
  budgetUsd: 0.01,
});
const run = await evals.run({
  id: "retry",
  tasks: [task],
  graders: [hypothesis, validation],
});
await evals.regrade(run.id, {
  graders: [
    {
      ...hypothesis,
      version: 2,
      question: "Was the refutable prediction stated before the probe?",
    },
  ],
});
```

The runnable composition is [library-command.ts](../tools/agent-evals/src/cli/library-command.ts). Its task metadata declares `diagnosis: "required"` and `validation: { required: true, targetFile, requiredChecks: ["lint", "build", "browser_snapshot"], flowPath, expectedText }`. Views decide applicability from that metadata; it is not inserted into the evaluated agent's prompt. Views are ordinary objects checked with `satisfies View`; `codeGrader` and `modelGrader` add the grader kind and infer evidence types from their View. Bump View and Grader versions when their meaning changes.

`evals.run(suite, { repetitions, limits })` runs trials sequentially and supports per-run limit overrides for each trial. `piRunner({ limits })` supplies runner defaults, and a direct `runner.run(task, { trialId, limits })` supplies per-trial overrides. `evals.grade(trialId, { graders })` grades one saved trial; `evals.regrade(runId, { graders })` regrades all trials in a saved suite run. A code-only suite needs no Judge, and saved-evidence grading needs no Runner. Implement the small `Runner`, `Judge`, or `Store` interface to replace an adapter.

The current Pi adapter loads repository task definitions from `evals/tasks/`; task ID, version, and prompt must match the selected definition. Pin a full repository commit and keep the prompt natural when measuring skill activation. Starting defects and independent acceptance belong to the environment adapter, outside the agent's writable controls. Add a new local acceptance case only when its assertions match the intended task, and verify both the defective and repaired behavior. New Views can be tested entirely against saved evidence.

## Environment and interpretation limits

The repository fixture exercises the real Next.js login UI against an unavailable loopback authentication endpoint. It does not test successful authentication, database behavior, Supabase integration, or broader wedding workflows. Offline font responses and webpack builds are explicit environment differences. Both `playwright-cli` and the installed `@playwright/test` can use the selected browser. The production-linked Pi sandbox is not used.

The evaluator stops registered process groups, runs its own acceptance checks, captures source changes and artifacts, and cleans up private configuration and the local server. Cleanup cannot guarantee termination of a tool-created child that detaches into a new process group; it may continue writing the trial workspace. Source-stability checks detect changes between the captured snapshots, but do not prove that no writes occurred between them. Generated caches and immutable dependencies are excluded from source capture. Agent actions, environment setup, and evaluator checks keep separate attribution.

One recorded trace demonstrates integration, not judge accuracy, natural skill-selection quality, or instruction benefit. Those require contrasting hand-reviewed examples and fresh matched trials. Removing instructions from an existing recording is not an ablation. Skill availability, discovery, loading, adherence, and task outcome must remain separate observations. Broad experiment matrices are deferred.
