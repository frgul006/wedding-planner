# Pi Docker Sandbox for wedding-planner

This kit defines a `pi-wedding-planner` Docker Sandbox agent with the CLI tooling this repo expects:

- Node.js 24
- pnpm 10.12.1
- GitHub CLI (`gh`)
- Playwright CLI wrapper (`playwright-cli`) and Chromium browser dependencies
- Vercel CLI (`vercel`)
- Supabase CLI (`supabase`)
- Pi coding agent (`pi`)

## Credential model

The sandbox uses a split credential model:

- Vercel and Supabase token bytes stay on the host and are injected by Docker's credential proxy.
- Vercel/Supabase CLIs see format-valid placeholder tokens so their local validation passes before proxy substitution.
- Pi ChatGPT/Codex OAuth uses a dedicated read-write host cache at `~/.cache/wedding-planner/pi-auth`, mounted into new sandboxes so `/login` survives sandbox recreation.

Warning: the Pi OAuth cache is readable by sandbox processes. This setup intentionally reuses the main ChatGPT account OAuth state for smoother new sandboxes.

## One-time host setup

Create Docker custom secrets. Let `sbx` prompt for token values; do not pass real tokens with `--value` unless you accept shell-history exposure.

```bash
sbx secret set-custom -g \
  --host api.vercel.com \
  --env VERCEL_TOKEN \
  --placeholder vercel_proxy_managed_00000000000000000000000000000000

SUPABASE_PLACEHOLDER="sbp_0123456789abcdef01234567"'89abcdef01234567'
sbx secret set-custom -g \
  --host api.supabase.com \
  --env SUPABASE_ACCESS_TOKEN \
  --placeholder "$SUPABASE_PLACEHOLDER"
```

Global custom secrets only apply when a sandbox is created. If an existing sandbox does not receive the placeholder env vars, remove/recreate it after setting the secrets.

## Validate

```bash
sbx kit validate sbx/pi-wedding-planner
```

## Run

From the repository root, use the wrapper so the sandbox gets git metadata, filtered Pi resources, shared Pi OAuth cache, and target config:

```bash
sbx/pi-wedding-planner/run.sh
```

The wrapper:

- fails before startup if the required Vercel/Supabase custom secrets are missing
- runs `sbx run --branch auto` by default
- mounts the repo's Git common directory so generated worktrees are valid Git repositories inside the sandbox
- copies safe user-level Pi configuration from `~/.pi/agent` into `~/.cache/wedding-planner/pi-agent`, excluding `auth.json`, sessions, and run history
- mounts that sanitized Pi mirror read-only so the kit can sync extensions, skills, prompts, package settings, and related config into `/home/agent/.pi/agent`
- mounts `~/.cache/wedding-planner/pi-auth` read-write and symlinks its `auth.json` into `/home/agent/.pi/agent/auth.json`
- writes wrapper config to `~/.cache/wedding-planner/sbx-config/sandbox.env` for sandbox startup
- verifies Vercel/Supabase auth with safe CLI calls
- auto-links Vercel and Supabase to the configured targets, failing if an existing link points elsewhere
- installs/updates Pi packages declared in the synced `settings.json` with `pi update --extensions` when the package configuration changes

On first run, the shared Pi OAuth cache is empty. In Pi, run `/login` once and select ChatGPT Plus/Pro (Codex). New sandboxes then reuse that cache.

Pass agent arguments after `--`:

```bash
sbx/pi-wedding-planner/run.sh -- --continue
```

Set `SBX_BRANCH=none` to run against the current checkout without creating a generated worktree:

```bash
SBX_BRANCH=none sbx/pi-wedding-planner/run.sh
```

Override auto-link targets if needed:

```bash
SBX_VERCEL_SCOPE=mjaox-wedding-planner \
SBX_VERCEL_PROJECT=wedding-planner \
SBX_SUPABASE_PROJECT_REF=wakdmxadoruqsstbokan \
sbx/pi-wedding-planner/run.sh
```

Manual equivalent for a generated worktree, after preparing the sanitized Pi mirror, Pi auth cache, and wrapper config:

```bash
sbx run --branch auto --kit sbx/pi-wedding-planner pi-wedding-planner . \
  /Users/fredrik/dev/wedding-planner/.git \
  /Users/fredrik/.cache/wedding-planner/pi-agent:ro \
  /Users/fredrik/.cache/wedding-planner/pi-auth \
  /Users/fredrik/.cache/wedding-planner/sbx-config:ro
```

## Operational notes

Avoid mounting `~/.pi/agent` directly. The wrapper creates a filtered mirror specifically to avoid exposing sessions and run history; only the dedicated Pi OAuth cache is shared.

Docker's host-level `sbx secret set -g openai --oauth` is consumed by Docker's built-in `codex` agent, but it is not exposed as a usable Pi OAuth token for this custom agent. Do not set `OPENAI_API_KEY=proxy-managed`; Pi's Codex provider decodes the OAuth token locally to derive the ChatGPT account ID, so Docker's proxy-managed sentinel token fails before proxy substitution.

Vercel and Supabase are auto-linked to the configured targets. The default targets are the documented production project values:

- Vercel scope/project: `mjaox-wedding-planner` / `wedding-planner`
- Supabase project ref: `wakdmxadoruqsstbokan`

This setup does not add command guardrails. With personal Vercel/Supabase tokens configured, sandbox agents can perform the same cloud operations those tokens allow.

GitHub API requests and `gh` are covered by the proxy-managed GitHub token. The kit configures HTTPS Git authentication from `GH_TOKEN`/`GITHUB_TOKEN` when available, but SSH key access still depends on Docker Sandbox SSH agent forwarding and network policy.

The network allowlist includes `api.46elks.com` for optional real SMS smoke testing, but 46elks credentials are not proxy-managed. Set `ELK46_USER`, `ELK46_PASSWORD`, and `ELK46_TEST_PHONE_NUMBER` separately before running `pnpm sms:test`.
