<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Project docs

- Local development setup: [`docs/local-development.md`](docs/local-development.md)
- Admin authentication notes: [`docs/admin-auth.md`](docs/admin-auth.md)
- Admin guest management notes: [`docs/admin-guests.md`](docs/admin-guests.md)

## Worktrees

Always create git worktrees in a sibling directory: `../wedding-planner-worktrees/<branch-slug>` (for example, `../wedding-planner-worktrees/feat-foo`). After creating a worktree, copy `.env.local` from the main checkout into the new worktree before starting work.

## Validation

Always validate user-facing app changes with `playwright-cli` against the local development server in addition to lint/build checks. Capture at least one `playwright-cli snapshot` for the changed flow.

## Pull requests

When creating or updating a pull request description, do not pass multi-line Markdown through an inline `gh pr create --body "..."` or `gh pr edit --body "..."` argument. Shell quoting and escaped newlines often break formatting. Instead:

1. Write the PR body to a temporary Markdown file with a single-quoted heredoc, for example `cat > /tmp/pr-body.md <<'EOF' ... EOF`.
2. Use `gh pr create --body-file /tmp/pr-body.md` or `gh pr edit --body-file /tmp/pr-body.md`.
3. Verify the rendered body with `gh pr view <number> --json body --jq .body` before considering the PR ready.
