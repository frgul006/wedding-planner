<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Project docs

- Local development setup: [`docs/local-development.md`](docs/local-development.md)
- Admin authentication notes: [`docs/admin-auth.md`](docs/admin-auth.md)

## Validation

Always validate user-facing app changes with `playwright-cli` against the local development server in addition to lint/build checks. Capture at least one `playwright-cli snapshot` for the changed flow.
