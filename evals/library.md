# Record once, inspect and regrade

The primary workflow is a small TypeScript library. A Runner records a trial, reusable Views prepare evidence, and code or model Graders check that evidence. A Judge answers model questions; a Store keeps immutable trials and append-only grading records. The earlier instruction-comparison CLI remains available.

## Run the example

Use Node 24, install workspace dependencies, and update native Pi to a version whose authenticated provider catalog contains `gpt-6-luna`. Keep a nonempty `TYPESAFE_API_KEY` in this worktree's ignored `.env.local`. The command reads only that key for Jev. Pi uses its existing subscription authentication separately.

```bash
pnpm evals library run --dry-run
pnpm evals library run
pnpm evals library show RUN_ID
pnpm evals library regrade RUN_ID --revision 2
```

`run` makes one isolated native attempt at `repository-login-retry`: after an unsuccessful login, the seeded error state leaves the button disabled. The natural task asks for investigation and repair without naming a skill or explaining the cause. Private acceptance exercises two actual local Server Actions, input validation, pending state, and error feedback. The auth endpoint is local and unavailable; successful authentication is outside this fixture.

Two Jev questions check the prepared diagnostic evidence. A deterministic grader checks agent-attributed lint, build, and explicit browser snapshot evidence after the final target edit. Evaluator acceptance checks remain separate and cannot earn agent-validation credit. Task completion and diagnostic behavior are separate results.

`regrade` changes the hypothesis question to require an observable prediction before the probe. It reads the saved trial and appends a grading record without launching Pi. `show` is entirely local. `--no-judge` selects only the deterministic check; `--dry-run` makes no calls. See `pnpm evals library --help` for paths and options.

For an interrupted native trial with a completed diagnostic attempt, explicitly opt into the narrower `completedDiagnosis` view:

```bash
pnpm evals library regrade RUN_ID --diagnosis-scope completed-attempt --revision 1
pnpm evals library regrade RUN_ID --diagnosis-scope completed-attempt --revision 2
```

This native-specific view audits recording continuity from the start through the first literal test attempt's completed turn. It submits the first visible hypothesis and every intervening tool action/result, including failures and authored test source. Earlier tool contents and all later activity are explicitly outside the semantic input. Coverage checks require matching native sources, paired calls/results, recorded context fingerprints and an observed stop after the boundary; unfamiliar formats or other capture gaps remain unknown. The original trial's status, gaps and bytes stay unchanged, and trial-wide validation still uses the original incomplete recording.

Repeated output lines may use `line-dictionary-v1`: ordered dictionary references reconstruct the exact original text, including empty lines and line endings. This is deterministic deduplication, not a generated summary. Both the dictionary and its order are supplied to Jev and retained in the report. This scope permits up to 30,000 state characters while keeping the adapter's conservative model-context check. Human calibration of the questions and this representation remains outstanding; a model's pass does not establish that the task was repaired or that a test succeeded.

The example bounds Pi to six minutes and 350,000 observed cumulative tokens, concurrency one, with no automatic trial retry. Its smoke profile selects Luna and preserves native provider, authentication, and saved reasoning without changing global settings. Jev uses pinned `jev-1.13.0`, no SDK retries, and a default aggregate reservation allowance of $0.01 per command. Admission estimates are not provider-enforced caps; in-flight agent usage can overshoot. Existing native provider retry settings remain observable.

The included profiles explicitly select `pi.endpoint: "catalog"`. The private Pi configuration removes an endpoint-only provider override and verifies the catalog endpoint before prompting. Saved and effective endpoint identities are recorded; global configuration is untouched. Complex overrides containing credentials or model definitions are rejected instead of redirected. Set `pi.endpoint: "native"` to preserve a working custom endpoint. Doctor detects the known stale local static-server configuration without sending a model prompt.

## Author checks with ordinary functions

Core and adapters have separate entry points. Importing the core does not import Pi, Jev, the filesystem, or a subprocess runtime.

```ts
import {
  defineView,
  modelGrader,
  codeGrader,
  createEvaluator,
} from "@wedding-planner/agent-evals";
import { piRunner } from "@wedding-planner/agent-evals/pi";
import { jevJudge } from "@wedding-planner/agent-evals/jev";
import { fileStore } from "@wedding-planner/agent-evals/files";
import {
  prepareDiagnosticEpisodes,
  validationHistory,
  checkValidationOrder,
} from "@wedding-planner/agent-evals/examples/diagnosis";

const diagnosis = defineView({
  id: "diagnosis",
  version: 1,
  prepare: prepareDiagnosticEpisodes,
});
const hypothesis = modelGrader({
  id: "hypothesis",
  version: 1,
  view: diagnosis,
  question: "Does the visible hypothesis make a falsifiable prediction?",
  rubric: {
    pass: "Predicts an observable result whose opposite would disprove it.",
    fail: "The complete recording contains no such prediction.",
    unknown: "The evidence cannot establish this.",
  },
});
const validation = codeGrader({
  id: "validation",
  version: 1,
  view: validationHistory,
  check: checkValidationOrder,
});
// Supply a repository task, absolute checkout paths, and the privately loaded key.
const evals = createEvaluator({
  runner: piRunner({
    sourceRepo,
    agentSource,
    runtimeMs: 360_000,
    maxTokens: 350_000,
  }),
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

This is an authoring example with explicit composition inputs, not a standalone script. The runnable composition is `tools/agent-evals/src/cli/library-command.ts`; it supplies task metadata declaring applicability and validation requirements. Code-grader evidence types are inferred from their View. No central registry is needed to add a library grader. Implement the small `Runner`, `Judge`, or `Store` interface to replace an adapter. A code-only suite does not need a Judge; regrading does not need a Runner.

## Inspect what the judge saw

Default library records live under ignored `evals/runs/library/`:

- `trials/TRIAL_ID.json`: normalized observable trace, original native source payloads, redacted artifacts, historical instruction/skill contents, outcome and runtime provenance.
- `runs/RUN_ID.json`: trial and original grading IDs for the suite run.
- `gradings/GRADING_ID/grading.json`: exact prepared items, source references, content hashes, grader and view versions, questions/rubrics, request membership, responses, errors and usage.
- `gradings/GRADING_ID/report.md`: readable evidence, verdicts, scope, gaps, considered sources, explicit supporting sources when supplied, and provider request/response.
- `gradings/GRADING_ID/requests/REQUEST_ID.json`: credential-free exact request body saved before dispatch. A journal alone does not prove dispatch succeeded; the final record marks dispatch attempts and their result. An interrupted journal remains inspectable.

The native adapter also retains its incremental original recording in `evals/runs/TRIAL_ID/`. Full command output is saved separately and resolved into a View when required. Source references point into the trial's events/artifacts/contexts; hashes detect accidental changes, not malicious rewriting. The file adapter refuses overwrites. Regrading preserves the trial bytes and previous grading records.

One View can produce several named items. The engine prepares it once per grading, records each item's data, scope, omissions, source references and capture coverage, then supplies declarative jobs to the Judge. Jev batches questions only when their actual complete prepared state matches, including scope and coverage; sharing a View name alone is insufficient. It preserves exact questions, resolved model, categorical distributions and usage. It does not invent prose rationales or claim that all considered evidence explicitly supports a verdict.

Capture gaps produce `unknown`; observable omitted required behavior can produce `fail`; inapplicable requirements produce `not_applicable`. Empty Views and unresolved references are preparation errors. Oversized state is rejected rather than silently truncated. Grader errors, trial failures, and behavioral failures are distinct. Per-grader rollup is any fail, otherwise any unknown, otherwise any pass, otherwise not applicable. Item counts describe one trial, not independent agent attempts.

## Limits and verification

The initial diagnostic View selects explicit visible hypothesis windows and retains their probes, failures and contradictions. If no hypothesis is parsed, it supplies the observable conversation and tools; a parser miss is not treated as proof that a hypothesis was absent. Hidden model reasoning is excluded. Large evidence may need a narrower, explicitly versioned View before Jev can grade it.

Validation recognizes attested literal supported lint/build/test commands and explicit `playwright-cli snapshot` receipts, verifies revision/order, and preserves uncertainty for unsupported command wrappers or recording gaps. The Pi adapter retains the current isolated four-tool surface and excludes arbitrary extensions/subagents. This is a recorded environment limitation, not full interactive Pi parity.

Run offline checks with `pnpm test:evals` and `pnpm check:evals`. The native zero-model red/green probe is documented in [repository preflight](examples/repository-preflight/README.md). `pnpm --filter @wedding-planner/agent-evals exec tsx test/jev-live-smoke.ts --live` explicitly opts into a tiny authored-fixture Jev batch/regrade check; without `--live` it makes no requests. An authored fixture is not a native agent trial.

One live trace verifies integration. It does not establish judge accuracy, natural skill selection quality, or instruction benefit. Those require contrasting hand-reviewed examples and fresh matched trials; removing an instruction from saved evidence is not an ablation. Broad repeated experiments remain deferred.
