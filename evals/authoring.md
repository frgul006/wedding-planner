# Add an evaluation

[Run the CLI](README.md) · [Code map](../tools/agent-evals/README.md)

## Add a task

Copy `evals/tasks/repository-ui-copy.json`, choose an ID matching the filename, and edit the prompt, target, expected result and selected graders. Pin a complete repository commit. Keep the prompt natural: do not repeat the instruction being tested or name a skill when measuring natural activation.

```json
{
  "id": "my-login-task",
  "title": "A clear task name",
  "version": "1",
  "kind": "ui",
  "environment": "repository",
  "repository": { "revision": "30d2388f71595d1ba65d0d2fabc8b97b6ee48f80" },
  "prompt": "Describe the user-visible result you want.",
  "targetFile": "app/admin/login/login-form.tsx",
  "expectedText": "The requested visible text",
  "flowPath": "/admin/login",
  "allowedChangedPaths": ["app/admin/login/login-form.tsx"],
  "acceptance": "admin-login-copy",
  "graders": ["browser-compliance", "acceptance-checks", "diff-scope"],
  "rubric": "repository-task"
}
```

This is a shape example, not a ready-made acceptance test. Select an existing acceptance case only when its actual assertions match your task; otherwise add one. `expectedText` alone proves only a substring. `allowedChangedPaths` declares exact file paths, including legitimate supporting tests as well as the main target, and the diff grader evaluates the independent source inventory rather than trusting the agent's Git index or `.gitignore`.

```bash
pnpm evals validate
pnpm evals run my-login-task --dry-run
pnpm evals experiment my-login-task
```

Bump the task version when meaning changes. Configuration hashes also capture edits. The schema checks referenced targets against the pinned commit, so ordinary `.ts`/`.tsx` source files work. Repository tasks use real installed dependencies with a matching lockfile. Synthetic tasks set `environment` to `synthetic` and select a fixture under `evals/fixtures`; those are intended for small regression cases.

## Add an independent acceptance case

Acceptance belongs to the environment adapter because it needs the final local application. Repository cases currently live in `tools/agent-evals/src/adapters/isolation/repository-acceptance.mjs`; their selection is recorded in the task. The evaluator executes a private copy after the agent stops. Add assertions for the observable user behavior, and prove that the original or defective implementation fails and the intended repair passes.

Register the new case ID in `REPOSITORY_ACCEPTANCE_IDS` in `repository-checkout.ts` as well as the private script's dispatcher. Preparation rejects unknown IDs before starting services.

A different service setup belongs in an environment adapter. Do not add arbitrary shell commands to task JSON. Expected answers, private acceptance controls, application credentials and production service hooks must stay outside the agent's workspace. Save check exit status and output with actor `evaluator`; these checks cannot earn agent-compliance credit.

The repository adapter captures changed source before/after and a patch. Graders run only on retained evidence, so the same final outcome can be regraded after the workspace disappears.

## Add a grader

Implement the `Grader` contract and register one factory in `src/adapters/task-graders.ts`. Select its ID in the task's `graders` array. Both live trials and saved regrading discover it through that registry; neither CLI command needs a branch for the new ID.

A grader returns its ID/version, execution status and judgments. It can also return usage, stable grading criteria and response metadata. A failed execution is different from a completed judgment with verdict `fail`.

```ts
const myGrader: Grader = {
  id: 'my-check',
  version: '1',
  async grade(evidence) {
    const judgment = judgeMyClaim(evidence);
    return {
      grader: 'my-check',
      version: '1',
      status: 'completed',
      grades: [judgment],
    };
  },
};

// In graderRegistry:
'my-check': { metering: 'none', create: () => myGrader },
```

Keep mechanical judgment functions in `src/domain/`; external model calls belong in adapters. Cite saved evidence IDs and respect attribution, success and applicability. Missing or unobservable evidence yields `unknown`. Version changes must reflect changed judgment meaning.

For a model grader, use `metering: 'semantic-api'`. Its factory receives the admitted key/config/rubric context, and the common planner reserves one bounded call for each selected model grader before any dispatch. Honor those bounds and return usage, model/rubric criteria and citations. The direct OpenAI adapter is the example; no tools or expensive fallback are configured. A new provider or metering scheme needs its own explicit budget implementation.

Use the registry's injectable interface in tests to verify a second grader without changing orchestration. Cover a known pass, a meaningful failure, absent evidence and plausible false positives. Confirm live and regrade paths give the same judgments for the same recording.

```bash
pnpm evals regrade RUN_ID
pnpm evals regrade RUN_ID --graders my-check,diff-scope
pnpm evals regrade RUN_ID --semantic --budget-usd 0.01
```

Use `--graders` to apply a newly registered grader to an old recording. The revision records that selection; original task expectations and sealed evidence remain unchanged. Explicitly selecting a model grader also requires `--semantic`.

A semantic rubric lives in `evals/rubrics`. The model receives task and before/after/patch evidence within its input bound, without tools. Oversized evidence produces a visible error. Add calibration examples and obtain human labels before claiming agreement with human judgment.

## Add a harness

Implement a `HarnessFactory` from `src/adapters/harnesses.ts` and register it there. Select its ID with the profile's `harness` field. A prepared harness supplies:

- An `AgentRunner` for a bounded request, normalized attributed events, native usage and explicit execution status.
- A `TrialEnvironment` for isolated preparation, artifact capture, independent final checks and unconditional cleanup.
- Inspected configuration, a readable description, expected model and reproducibility metadata.

`pi-harness.ts` contains the Pi-specific inspection, authentication rules, runner and environment wiring. The trial and experiment commands consume the returned contracts. A different agent must normalize its own observations and provide the same evidence guarantees; it must not label its output as Pi. The offline registry test uses a second harness to exercise this composition seam.

Pi remains the only live harness implementation. `doctor`, adapter configuration in the profile schema, and some CLI presentation still assume Pi. A real second backend may need changes there; the registry test proves that trial and experiment execution can consume another adapter, not that every CLI feature already supports it.

An environment's `finalize()` stops agent descendants, checks the final application and captures evidence while required services are available. Once `prepare()` returns an environment, orchestration always calls its `cleanup()`, including after agent or final-observation failures, before grading. If `prepare()` fails partway through, the adapter must stop any processes and remove private credentials itself before throwing; orchestration has no returned environment to clean up. Preserve failed trials and save evidence before grading. Test isolation and cleanup before using credentials or sending live prompts.

## Compare configurations

Profiles set the harness, runtime/budget bounds and grader configuration. The included `smoke` and `controlled` profiles differ only in Pi conversation policy: native settings versus disabled compaction/retries. Both retain the explicitly restricted tool surface described in [the setup guide](README.md).

```bash
pnpm evals run repository-docs --profile smoke
pnpm evals run repository-docs --profile controlled
pnpm evals compare FIRST_ID SECOND_ID --factor agent-configuration
```

For instruction comparisons use `experiment TASK`; it freezes one profile and schedules the enabled/disabled pair. `--pairs N` repeats with alternating condition order under one aggregate API allowance. Repetition does not itself establish statistical confidence or calibrate semantic grading. Model comparisons must declare `--factor model` and keep the other conditions fixed.
