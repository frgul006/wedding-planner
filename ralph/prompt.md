# ISSUES

GitHub issues labeled `ready-for-agent` are provided at start of context. Parse them to understand the eligible work.

Ralph works from GitHub Issues, not local `issues/*.md` files. Existing local issue and PRD files may be useful reference material if a GitHub issue links to them, but they are not the task queue.

Work on AFK issues only. If an issue looks HITL, underspecified, blocked, or unsafe for an unattended agent, do not implement it; comment on the GitHub issue and move it to the appropriate state label (`needs-info` or `ready-for-human`).

You've also been passed a file containing the last few commits. Review these to understand what work has been done.

If all eligible AFK tasks are complete, output <promise>NO MORE TASKS</promise>.

# TASK SELECTION

Pick exactly one GitHub issue. Prioritize tasks in this order:

1. Critical bugfixes
2. Development infrastructure

Getting development infrastructure like tests and types and dev scripts ready is an important precursor to building features.

3. Tracer bullets for new features

Tracer bullets are small slices of functionality that go through all layers of the system, allowing you to test and validate your approach early. This helps in identifying potential issues and ensures that the overall architecture is sound before investing significant time into development.

TL;DR - build a tiny, end-to-end slice of the feature first, then expand it out.

4. Polish and quick wins
5. Refactors

Before changing code, claim the selected issue so parallel Ralph runs do not duplicate work:

```bash
gh issue edit <issue-number> --add-label agent-in-progress
```

# EXPLORATION

Explore the repo. Follow `AGENTS.md`, `CLAUDE.md`, and `docs/agents/*.md`.

# IMPLEMENTATION

Use /tdd to complete the task.

# FEEDBACK LOOPS

Before committing, run the feedback loops required by the repo. At minimum:

- `pnpm run build`
- `pnpm run lint`
- `pnpm run test:e2e`

For user-facing changes, also validate with `playwright-cli` and capture at least one snapshot for the changed flow.

# COMMIT AND PR

Make a git commit. The commit message must include:

1. Key decisions made
2. Files changed
3. Blockers or notes for next iteration

Open a draft pull request for the work. Use a PR body file, not an inline multi-line `gh pr create --body "..."` argument.

If the task is complete, include `Closes #<issue-number>` in the PR body so GitHub closes the issue when the PR merges. Do not close the issue manually.

After opening the draft PR, run the repo's review workflow against the draft PR and address or report findings.

# THE ISSUE

If the task is complete:

- Leave `agent-in-progress` on the issue so Ralph does not pick it again while the PR is open.
- Make sure the PR body includes `Closes #<issue-number>`.
- Add a short issue comment linking to the PR and summarizing the result.

If the task is not complete:

- Add a GitHub issue comment describing what was done and what remains.
- Remove `agent-in-progress` if another agent can safely continue later.
- If the issue needs human input or cannot be implemented AFK, replace `ready-for-agent` with `needs-info` or `ready-for-human` as appropriate.

# FINAL RULES

ONLY WORK ON A SINGLE TASK.
