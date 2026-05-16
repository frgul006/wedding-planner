# Issue tracker: GitHub

New issues and PRDs for this repo live as GitHub issues in `frgul006/wedding-planner`. Use the `gh` CLI for all issue-tracker operations.

## Source of truth

- GitHub Issues is the source of truth for new AI-created PRDs, implementation issues, triage notes, and agent-ready work.
- Existing local files under `issues/`, `issues/done/`, and `docs/prd/` are historical/reference material. Read them when linked or relevant, but do not create new local issue files as the tracker.
- If a legacy prompt explicitly passes local issue files as context, treat those files as input context for that run; do not duplicate or migrate them to GitHub unless the user asks.

## PRDs and implementation issues

Use GitHub issues for both PRDs and implementation work, but keep their roles distinct:

- **PRD issue** — the parent/specification container: problem, solution, user stories, decisions, acceptance criteria, and links to child issues. Apply the `prd` label. Do **not** apply `ready-for-agent` to PRD/container issues; Ralph only works implementation slices.
- **Implementation issue** — one independently doable vertical slice. Link it back to the parent PRD with `Parent PRD: #<number>` when applicable. Apply `ready-for-agent` only when the issue is ready for AFK pickup.

When breaking a PRD into implementation issues, publish blockers first so later issues can reference real GitHub issue numbers. Add a checklist of child issues to the PRD body or a PRD comment when useful.

## Ralph AFK runner

The `ralph/` scripts consume open implementation issues labeled `ready-for-agent`, excluding issues labeled `prd` or `agent-in-progress`. They claim one issue before invoking Pi, using a shared local git lock plus the `agent-in-progress` label so parallel Ralph runs from sibling worktrees do not duplicate an active agent task.

When Ralph starts work, the wrapper adds `agent-in-progress` to the selected issue. If startup or Pi invocation fails, the wrapper removes that label. When Ralph opens a PR, the PR body should include `Closes #<issue-number>` and `agent-in-progress` should remain until the issue closes on merge. If the task cannot be completed, Ralph should comment with status and remove `agent-in-progress` unless an open PR should keep the issue reserved.

If a run is killed hard or a PR for an `agent-in-progress` issue is closed without merging, remove `agent-in-progress` or move the issue to `needs-info` / `ready-for-human` so it does not disappear from AFK pickup indefinitely.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body-file <file> --label "..."`. Use a temporary Markdown file for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments --json number,title,body,labels,comments,state,author,createdAt,updatedAt`.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body-file <file>` for multi-line comments.
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`.
- **Close**: `gh issue close <number> --comment "..."`.

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone.

## When a skill says "publish to the issue tracker"

Create a GitHub issue. Do not write a new file under `issues/`.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`. If the user gives a local file path instead, read that file as reference/context rather than treating it as the configured issue tracker.
