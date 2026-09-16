# Keep Agent Evaluation independent of the Wedding application

Status: accepted; revised after the September 2026 PoC review

Agent Evaluation is a separate bounded context in `tools/agent-evals`, with repository tasks, regression fixtures, profiles and rubrics under `evals`. Domain/application code owns trial lifecycle, scheduling, comparison and grading. Harness, environment, model-grader and storage adapters own external effects. The Wedding application does not import evaluation code.

The original synthetic-page milestone proved transport and evidence plumbing but could not support claims about work in this repository. The primary demonstration now uses the actual pinned Wedding checkout, its TypeScript/React/Next.js runtime, natural task prompts and independent post-edit acceptance. Synthetic fixtures remain regression tests. The production-linked Pi sandbox and application credentials remain excluded.

Native Pi resource discovery uses the original checkout's actual trust policy. The adapter records the selected and effective resources and preserves native model/authentication. Its isolated four-tool surface still suppresses optional extension/package code; this explicit limitation prevents extrapolating to the user's complete interactive extension setup. Native conversation settings and an explicit controlled ablation are separate configurations.

Tasks select graders through a registry. Live grading and saved-evidence regrading use the same operation and rich results. An experiment freezes its configuration, reserves aggregate direct API spend, retains both successful and failed trials, and compares one declared factor while holding the remaining conditions fixed. Before/after source, patches and evaluator-owned acceptance support outcome judgments independently of agent behavior.

One pair establishes observations and exercises the evaluation workflow. It does not establish whether an instruction is needed, whether a semantic grader agrees with people, or whether results generalize across workflows. See [Agent Evaluation](../../evals/README.md) for the supported claims, limitations and extension recipes.
