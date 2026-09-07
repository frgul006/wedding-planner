# Keep Agent Evaluation independent of the Wedding application

Status: accepted

Agent Evaluation is a separate bounded context implemented in the `tools/agent-evals` TypeScript workspace package, with repository-specific tasks, synthetic fixtures, profiles and rubrics under `evals`. Its application layer coordinates AgentRunner, TrialEnvironment, Grader and RunStore ports. Native Pi RPC, OS isolation, filesystem evidence and direct OpenAI AI SDK grading are adapters; the Wedding domain and Next.js application do not depend on them.

The first milestone evaluates the AGENTS.md browser-validation instruction on a synthetic local Wedding page and a docs-only applicability case. Native Pi instruction/skill discovery is retained within an explicitly recorded controlled profile. The existing production-linked Pi sandbox is not an evaluation environment. Deterministic evidence establishes mechanical compliance; a separately billed, provisional semantic grader judges outcome clarity. Saved attributed evidence supports regrading and matched comparisons. The first trial cannot establish whether an instruction is needed, and semantic calibration requires human labels.

See [Agent Evaluation setup and scope](../../evals/README.md) for commands, isolation limits, report schema, budgets, profile deviations and the focused diagnose backlog.
