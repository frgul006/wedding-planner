# Keep agent evaluation independent of the Wedding application

Status: accepted

## Decision

Agent evaluation is a separate bounded context in `tools/agent-evals`, with repository task definitions, profiles, and fixtures under `evals`. Its public surface is a small TypeScript library: a Runner records one task attempt; a versioned View prepares evidence; code or model Graders define checks; a Judge answers model questions; a Store persists trials and grading records. Concrete Pi, Jev, and filesystem adapters depend inward. The Wedding application does not import evaluation code.

The supported workflow is to record an isolated native Pi trial, inspect the exact evidence supplied to each grader, and revise a question or View against the saved recording. The CLI composes this workflow for the login-retry fixture through `pnpm evals library run`, `show`, and `regrade`. New Views and Graders are ordinary functions, without a central registration step. Experiment scheduling and broad matched comparisons are outside the current CLI.

## Recording and preparation

Trials are immutable inputs, saved before grading. Native events are recorded incrementally with actor attribution, tool results, artifacts, historical instruction/skill contents, effective configuration, usage, and capture gaps. Environment setup and independent evaluator acceptance cannot count as agent behavior. Historical context must come from the recording rather than current files.

Prepared items declare their data, scope, source references, omissions, applicability, and coverage. Shared Views prepare once; evidence and grader versions survive regrading. Missing coverage yields `unknown`, while omitted required behavior in complete evidence can fail. Inapplicability, execution errors, and behavioral failures remain distinct. Deterministic selection and deduplication may narrow state, but must retain failed attempts and contradictions within the declared scope and never silently truncate oversized input.

A scoped diagnostic View may grade an audited completed attempt inside an interrupted trial. It must disclose excluded earlier and later context, and it cannot change the parent trial's status or establish eventual repair. Full recordings remain available for inspection. Source references identify audit material; they are not a substitute for including necessary content in a judge request.

## External effects

Native Pi uses fresh local trial workspaces and the original checkout's actual resource trust policy. Instructions and skills are discovered through Pi rather than force-loaded by the diagnostic task. Profiles explicitly select Luna and preserve native provider authentication and saved reasoning without modifying global settings. Selected and effective resources, model, and endpoint identities are recorded. The isolated tool surface excludes optional extension/package code and subagents, so results do not establish parity with the full interactive Pi environment.

Application credentials, grading controls, expected answers, and production hooks remain outside the agent's writable workspace. The repository fixture uses local services and an unavailable loopback authentication endpoint. It does not test successful authentication or production/database integration.

The Jev adapter uses categorical questions with explicit answer criteria and batches only identical submitted evidence envelopes. Exact credential-free request bodies and question/version mappings are journaled before dispatch. Responses retain the model, probabilities, confidence, usage, and errors without invented explanations or supporting citations. Aggregate admission estimates, bounded requests, cancellation, and no automatic judge retry constrain live use; estimates are not provider-enforced spending caps.

Per-trial runtime, completed-turn, and weighted-token limits are independent of judge budgets and resolve before environment preparation. Any reached limit stops the attempt, retaining its first stop cause and remaining evidence. Default values and configuration precedence are documented in the usage guide rather than fixed by this architecture decision.

## Consequences

Regrading requires neither Pi nor a repeat of the task and appends a new record while preserving the trial and earlier grades. Code-only suites require no Judge. Other Runner, Judge, or Store implementations can use the same portable contracts without changing grader authoring.

The diagnostic example checks falsifiable hypotheses, relevant probes, and validation after the final edit. Successful transport, an authored positive fixture, or one repository trial does not establish judge accuracy or instruction benefit. Human calibration, natural skill-selection positives and negatives, and fresh matched trials remain separate work. Dashboards, distributed execution, generated evidence summaries, and broad experiment matrices are deferred.

See [usage and authoring](../../evals/README.md) and [package architecture](../../tools/agent-evals/README.md).
