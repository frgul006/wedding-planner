# Keep agent evaluation independent of the Wedding application

Status: accepted

## Decision

`packages/agent-evals` is one publishable TypeScript library and CLI. Its core defines Runner, View, Grader, Judge, and Store contracts. Pi, Jev, and filesystem adapters depend inward and are available through explicit subpath exports. The core runtime does not import adapters, CLI code, or consumer files.

`evals/` is a consumer example. It owns Wedding's tasks, pinned application commit, starting defects, local environment, acceptance checks, evidence Views, grader questions, and rubrics. It imports only public package exports. The application itself does not import evaluation code.

The CLI loads a trusted TypeScript config with a suite and lazy runner/judge factories. Commands are generic `run`, `show`, and `regrade`; there are no Wedding task selectors or grading revisions embedded in the executable. Inspection needs only a store, regrading never constructs a runner, and code-only grading needs no judge. New tasks, Views, and Graders use ordinary TypeScript without a registry.

The Pi adapter records execution and exposes resource/configuration helpers. Consumers provide an explicit environment callback owning setup, isolation, final observations, and cleanup. The adapter accepts any portable task and does not load a repository catalog or require a web application. The Jev adapter handles provider transport and response validation; consumers own the meaning of each judgment.

## Evidence and execution

Trials are immutable inputs, saved before grading. Native events preserve actor attribution, tool results, artifacts, historical instruction/skill contents, effective configuration, usage, and capture gaps. Environment setup and evaluator acceptance cannot count as agent behavior. Historical context comes from the recording rather than current files.

Prepared items declare their data, scope, source references, omissions, applicability, and coverage. Shared Views prepare once. Versions and evidence hashes survive regrading. Missing coverage yields `unknown`, while omitted required behavior in complete evidence can fail. Inapplicability, execution errors, and behavioral failures remain distinct. Selection and deduplication disclose excluded context; oversized input is never silently truncated. References identify audit material, not content available to a model unless submitted.

The Jev adapter batches only identical submitted evidence envelopes. The evaluator journals credential-free request bodies and question/version mappings through the Store before dispatch. Responses retain model identity, probabilities, confidence, usage, and errors without invented explanations or supporting citations. Bounded requests, cancellation, no automatic judge retry, and aggregate admission estimates constrain live use; estimates are not provider-enforced spending caps.

Per-trial runtime, completed-turn, and weighted-token limits are independent of judge budgets and resolve before environment preparation. Any reached limit stops the attempt while retaining its first stop cause and evidence. Shared defaults are 30 minutes, 100 turns, and 1,000,000 weighted tokens; cached tokens count at 0.1×. Runner, task, and per-trial settings can override them.

## Consequences

The package is tested as an installed tarball in an unrelated directory using public imports and its executable. Wedding tests and native probes separately verify the example integration. A second toy Pi environment checks that native execution has no Wedding or Next.js dependency.

Regrading requires neither Pi nor a repeat of the task and appends new records while preserving previous ones. Other Runner, Judge, and Store implementations can use the same contracts. There is one package with explicit entry points; separate package releases and a plugin framework are unnecessary at this stage.

Wedding's macOS environment, local login fixture, native configuration differences, and process-cleanup limitations are documented with the consumer. One recorded trial demonstrates integration, not judge accuracy, natural skill-selection quality, or instruction benefit. Human calibration and fresh matched trials remain separate work. Dashboards, distributed execution, generated evidence summaries, and broad experiment matrices are deferred.

See [the library](../../packages/agent-evals/README.md) and [the Wedding example](../../evals/README.md).
