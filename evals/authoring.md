# Add an evaluation

Start with a task JSON when the existing fixture and graders can express the question. Add a new adapter only when the required runtime or evidence changes.

[Run evaluations](README.md) · [Code boundaries](../tools/agent-evals/README.md)

## Add a task using an existing fixture

Create `evals/tasks/readme-start.json`:

```json
{
  "id": "readme-start",
  "title": "Explain how to start the Wedding page",
  "version": "1",
  "kind": "docs",
  "fixture": "wedding-copy",
  "rubric": "task-clarity",
  "prompt": "README.md should help a new contributor run this Wedding page. Add a concise Local development section explaining pnpm dev. This is a documentation change; the page already works.",
  "targetFile": "README.md",
  "expectedText": "pnpm dev",
  "flowPath": "/"
}
```

Then validate and preview it:

```bash
pnpm evals validate
pnpm evals tasks
pnpm evals run readme-start --dry-run
```

The filename determines the CLI name and must match `id`. There is no source-code registry to update. `title` keeps the task catalog easy to scan. The optional `fixture` and `rubric` fields default to `wedding-copy` and `task-clarity`; specify them for new tasks so the dependencies are visible.

| Field          | Meaning                                                                  |
| -------------- | ------------------------------------------------------------------------ |
| `id`           | Lowercase, hyphenated identifier matching the JSON filename              |
| `version`      | Version of the task’s prompt and expectations                            |
| `kind`         | `ui` or `docs`; determines browser-rule applicability                    |
| `fixture`      | Directory name under `evals/fixtures/`                                   |
| `rubric`       | Markdown filename under `evals/rubrics/`, without `.md`                  |
| `prompt`       | The realistic request sent to Pi                                         |
| `targetFile`   | An existing text file inside the fixture                                 |
| `expectedText` | A minimal observable outcome; never sent as a hidden grading instruction |
| `flowPath`     | Local URL path used to identify the changed browser flow                 |

The task above reuses the docs expectations already covered by `task-clarity`. A different requested result may need its own rubric. The current shared rubric explicitly describes the schedule-link copy task and the `pnpm dev` documentation task; it is not a general-purpose specification for every new task.

`expectedText` supports a narrow code-based check. Finding that substring does not prove layout, accessibility, destination correctness or absence of unrelated edits. Give those claims an appropriate deterministic or semantic grader. The model grader currently receives the task prompt and captured target-file artifacts, not the entire workspace or an unrestricted transcript.

Keep prompts natural. When measuring whether an AGENTS.md instruction is followed, the task should not repeat that instruction. When eventually measuring natural skill activation, avoid naming the skill in positive task prompts. Explicitly requested skill execution is a separate question. Before measuring a repository skill, check `pnpm evals doctor --no-grader`: an untrusted worktree can legitimately suppress project skills. Establish the intended native trust/profile deliberately and keep it fixed across trials.

Bump `version` when a task’s meaning changes. Content hashes also record edits, even if someone forgets to bump the label. Keep enabled and disabled trials on the same task version and content.

## Add a fixture within the current environment

Copy `evals/fixtures/wedding-copy/` to a new lowercase, hyphenated directory, adapt its synthetic content, and point the task’s `fixture` field at it.

The current local adapter has a deliberately small runtime contract:

- `scripts/server.mjs` starts a dependency-free local Node server, reads the assigned `PORT` and binds to `127.0.0.1`. The adapter starts this file directly.
- `package.json` exposes successful `pnpm lint` and `pnpm build` commands. These are preflighted inside the sandbox before Pi receives a prompt.
- The task’s `targetFile` already exists inside the fixture and uses `.md`, `.html`, `.yaml`, `.yml`, `.json`, `.log` or `.txt`. The current collector observes one target and browser snapshots, skipping files larger than 256,000 bytes.
- `flowPath` is a route the server serves. Changing the JSON does not create a route.
- Files and runtime services are synthetic and self-contained. Use regular files, not symlinks, and keep secrets, deployments, messaging and production hooks out of fixture startup.

Fixtures contain the work the agent sees. Tasks, expected answers, rubrics and calibration controls live outside the agent’s writable environment. Fixture lint/build scripts should check ordinary application validity rather than reveal the hidden expected answer.

`validate` checks configuration and referenced targets/rubrics; it does not start the server or prove browser behavior. After offline validation, exercise one bounded trial:

```bash
pnpm evals run YOUR_TASK --dry-run
pnpm evals run YOUR_TASK --no-grader
pnpm evals show latest
```

A fixture needing Next.js dependencies, multiple services, databases or a different operating system needs an environment-adapter change. Simply adding shell commands to JSON does not extend the sandbox. Preserve the current adapter’s fail-closed restrictions while implementing the new runtime through the `TrialEnvironment` port.

## Add a semantic rubric

Create `evals/rubrics/YOUR_RUBRIC.md` and select its basename in the task JSON. Describe the claim being judged, concrete pass/fail criteria, what evidence is insufficient, and what falls outside the judgment.

A useful rubric separates facts the grader can see from assumptions. For example, a target HTML file can support a judgment about link wording and its declared destination, while successful browser execution needs command evidence and belongs to a code-based grader.

Retain the verdict vocabulary: `pass`, `fail`, `unknown`, `not-applicable`. Require exact evidence IDs and verbatim quotations. The adapter already treats all evidence as untrusted, exposes no tools, bounds input/output, verifies citations and preserves grader failures as unknown.

Keep the rubric, task prompt and captured target within the profile’s combined `maxInputChars` bound. Oversized semantic input is rejected before generation rather than silently truncated.

Add a small calibration file under `evals/calibration/` covering an obvious success, a meaningful defect, insufficient evidence and an instruction-injection attempt. Expected labels authored by an agent are sanity expectations. A person must fill `humanVerdict`, reviewer and date before the grader is described as calibrated.

A semantic regrade uses the currently selected task rubric and profile and records their provenance:

```bash
pnpm evals regrade RUN_ID --semantic --budget-usd 0.01
```

That command adds one API call without rerunning Pi. Prefer offline deterministic regrading while developing mechanical evidence checks. Compare whole revisions with matching grader versions, rubric and configuration; do not combine favorable judgments from different revisions.

## Add a deterministic grader

Put a pure evidence-to-judgment function in `tools/agent-evals/src/domain/`. It should accept the existing `TrialEvidence`, return a `Grade`, and use only evidence whose actor, success and provenance support the claim. Wire it into `gradeTrial`, or supply a different `Grader` implementation at the CLI’s composition boundary when a task needs a distinct set of judgments.

Use the existing browser and outcome graders as examples, with these invariants:

- An agent’s claim does not prove tool execution. Environment/evaluator actions cannot count as agent behavior.
- Incomplete, truncated or unattested evidence yields `unknown`, not an invented pass or fail.
- Applicability is separate from observed behavior, and execution status is separate from a grade.
- Each grade identifies its grader/version, explains the decision and cites saved evidence IDs.

The Pi adapter translates raw protocol messages into domain observations. A grader should consume those observations rather than parse new Pi event shapes itself. If a new claim needs evidence the domain does not yet represent, add the observation contract and normalize it in the relevant adapter.

Add meaningful offline cases under `tools/agent-evals/test/`: a known pass, a real failure, missing evidence and the most plausible false positive. For browser changes, the minimized real native traces in `evals/calibration/mechanical/` provide additional regression material. Increment the grader version when its meaning changes, then regrade saved runs before spending tokens on another trial.

## Add a profile

Copy `evals/profiles/smoke.json`, give the copy a descriptive filename and `id`, and change the relevant limits. The CLI selects the filename without `.json`:

```bash
pnpm evals profiles
pnpm evals validate
pnpm evals run ui-copy --profile YOUR_PROFILE --dry-run
```

`agentBilling: "subscription"` requires a null agent dollar threshold and verified supported OAuth authentication. An API-billed agent needs an explicit dollar threshold. Pi token/runtime bounds always remain active. Grader bounds and the direct API allowance remain separate.

Profiles currently retain concurrency one and zero automatic retries, with schema ceilings appropriate to this pilot. The [configuration adapter](../tools/agent-evals/src/adapters/evaluation-config.ts) is the single schema. Treat broad scheduling and total experiment spending as a separate application feature rather than bypassing those limits in scripts.

Changing the grader model requires reviewed availability, structured-output support and prices. No automatic expensive fallback is configured. Model/profile changes create different experiment conditions and cannot be silently mixed into an instruction comparison.

## Add an agent or environment adapter

Implement the existing port from `domain/types.ts`, then compose it in `src/cli/commands/`. Keep external APIs, subprocesses and filesystem operations inside adapters.

| Port               | Responsibilities                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `AgentRunner`      | Run one bounded request, emit attributed observations, retain errors and usage, and return an explicit execution status                     |
| `TrialEnvironment` | Prepare an isolated workspace/services, expose provenance, collect artifacts and stop descendants/remove private credentials during cleanup |
| `Grader`           | Produce versioned evidence-backed judgments without owning the agent lifecycle                                                              |
| `RunStore`         | Retain manifests, events and reports; durable evidence remains available after a later failure                                              |

Keep the current native Pi adapter as the baseline. Another agent must normalize its own evidence rather than masquerade as Pi. An environment must prove its boundary and cleanup behavior before using live credentials or model calls. Use in-memory ports and controlled fake processes for offline tests, then one explicit local preflight/live smoke when prerequisites permit.

The application layer coordinates the ports and saves evidence before grading. Preserve that ordering: an expensive completed trial must remain regradable even if a later grader fails.
