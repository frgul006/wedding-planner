# Pi Docker Sandbox for wedding-planner

This kit defines a `pi-wedding-planner` Docker Sandbox agent with the CLI tooling this repo expects:

- Node.js 24
- pnpm 10.12.1
- GitHub CLI (`gh`)
- Playwright CLI wrapper (`playwright-cli`) and Chromium browser dependencies
- Vercel CLI (`vercel`)
- Supabase CLI (`supabase`)
- Pi coding agent (`pi`)

## Validate

```bash
sbx kit validate sbx/pi-wedding-planner
```

## Run

From the repository root, use the wrapper so the sandbox gets git metadata plus a sanitized mirror of user-level Pi resources:

```bash
sbx/pi-wedding-planner/run.sh
```

The wrapper:

- runs `sbx run --branch auto` by default
- mounts the repo's Git common directory so generated worktrees are valid Git repositories inside the sandbox
- copies safe user-level Pi configuration from `~/.pi/agent` into `~/.cache/wedding-planner/pi-agent`, excluding `auth.json`, sessions, and run history
- mounts that sanitized Pi mirror read-only so the kit can sync extensions, skills, prompts, package settings, and related config into `/home/agent/.pi/agent`
- installs/updates Pi packages declared in the synced `settings.json` with `pi update --extensions` when the package configuration changes

Pass agent arguments after `--`:

```bash
sbx/pi-wedding-planner/run.sh -- --continue
```

Set `SBX_BRANCH=none` to run against the current checkout without creating a generated worktree:

```bash
SBX_BRANCH=none sbx/pi-wedding-planner/run.sh
```

Manual equivalent for a generated worktree, after preparing the sanitized Pi mirror:

```bash
sbx run --branch auto --kit sbx/pi-wedding-planner pi-wedding-planner . \
  /Users/fredrik/dev/wedding-planner/.git \
  /Users/fredrik/.cache/wedding-planner/pi-agent:ro
```

Avoid mounting `~/.pi/agent` directly unless you are comfortable exposing `auth.json` and session history to the sandbox; the wrapper creates a filtered mirror specifically to avoid that.

The kit expects host credentials to be configured with `sbx secret` or matching environment variables for any services you want to use, especially `GH_TOKEN`/`GITHUB_TOKEN`, `VERCEL_TOKEN`, and `SUPABASE_ACCESS_TOKEN`.

The agent starts Pi with `--model openai-codex/gpt-5.5` so ChatGPT/Codex is the default model. Authenticate Pi from inside the sandbox with `/login`, then select ChatGPT Plus/Pro (Codex). Pi stores those OAuth credentials in `~/.pi/agent/auth.json`.

The agent uses persistent sandbox storage, so Pi auth and settings survive stopping and re-running the same sandbox. If you remove the sandbox or create a different sandbox name/worktree, authenticate again or copy credentials yourself outside of this repo.

Docker's host-level `sbx secret set -g openai --oauth` is currently consumed by Docker's built-in `codex` agent, but it is not exposed as a usable Pi OAuth token for this custom agent. Do not set `OPENAI_API_KEY=proxy-managed`; Pi's Codex provider decodes the OAuth token locally to derive the ChatGPT account ID, so Docker's proxy-managed sentinel token will fail before any proxy substitution can happen.

GitHub API requests and `gh` are covered by the proxy-managed GitHub token. The kit does not inject SSH keys or turn `GH_TOKEN` into a Git smart-HTTP credential; configure SSH/HTTPS Git credentials separately if you need to run `git fetch` or `git push` inside the sandbox.

The network allowlist includes `api.46elks.com` for optional real SMS smoke testing, but 46elks credentials are not proxy-managed. Set `ELK46_USER`, `ELK46_PASSWORD`, and `ELK46_TEST_PHONE_NUMBER` separately before running `pnpm sms:test`.
