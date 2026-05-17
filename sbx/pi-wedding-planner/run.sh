#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PI_AGENT_SRC="${PI_AGENT_SRC:-$HOME/.pi/agent}"
PI_AGENT_MIRROR="${PI_AGENT_MIRROR:-$HOME/.cache/wedding-planner/pi-agent}"
PI_AUTH_CACHE="${PI_AUTH_CACHE:-$HOME/.cache/wedding-planner/pi-auth}"
SBX_CONFIG_DIR="${SBX_CONFIG_DIR:-$HOME/.cache/wedding-planner/sbx-config}"
SBX_BRANCH="${SBX_BRANCH:-auto}"
SBX_SKIP_SECRET_PREFLIGHT="${SBX_SKIP_SECRET_PREFLIGHT:-0}"
SBX_VERCEL_SCOPE="${SBX_VERCEL_SCOPE:-mjaox-wedding-planner}"
SBX_VERCEL_PROJECT="${SBX_VERCEL_PROJECT:-wedding-planner}"
SBX_SUPABASE_PROJECT_REF="${SBX_SUPABASE_PROJECT_REF:-wakdmxadoruqsstbokan}"
SBX_VERCEL_PLACEHOLDER="${SBX_VERCEL_PLACEHOLDER:-vercel_proxy_managed_00000000000000000000000000000000}"
SBX_SUPABASE_PLACEHOLDER_PREFIX="${SBX_SUPABASE_PLACEHOLDER_PREFIX:-sbp_0123456789abcdef01234567}"
SBX_SUPABASE_PLACEHOLDER_SUFFIX="${SBX_SUPABASE_PLACEHOLDER_SUFFIX:-89abcdef01234567}"
SBX_SUPABASE_PLACEHOLDER="${SBX_SUPABASE_PLACEHOLDER:-${SBX_SUPABASE_PLACEHOLDER_PREFIX}${SBX_SUPABASE_PLACEHOLDER_SUFFIX}}"

usage() {
  cat <<'EOF'
Usage: sbx/pi-wedding-planner/run.sh [-- AGENT_ARGS...]

Creates/runs the pi-wedding-planner sandbox with:
  - git metadata mounted so worktree sandboxes are real git repos
  - a sanitized copy of user-level Pi resources mounted read-only
  - a shared, sandbox-only Pi OAuth auth cache mounted read-write
  - generated target config for Vercel/Supabase auto-linking

Required one-time Docker custom secrets:
  sbx secret set-custom -g --host api.vercel.com --env VERCEL_TOKEN \
    --placeholder vercel_proxy_managed_00000000000000000000000000000000
  SUPABASE_PLACEHOLDER="sbp_0123456789abcdef01234567"'89abcdef01234567'
  sbx secret set-custom -g --host api.supabase.com --env SUPABASE_ACCESS_TOKEN \
    --placeholder "$SUPABASE_PLACEHOLDER"

Environment:
  SBX_BRANCH                  Branch for sbx --branch (default: auto; set to none to disable)
  SBX_SKIP_SECRET_PREFLIGHT   Set to 1 to skip host custom-secret checks
  SBX_VERCEL_SCOPE            Vercel team/scope slug (default: mjaox-wedding-planner)
  SBX_VERCEL_PROJECT          Vercel project name/id (default: wedding-planner)
  SBX_SUPABASE_PROJECT_REF    Supabase project ref (default: wakdmxadoruqsstbokan)
  PI_AGENT_SRC                Host Pi agent dir (default: $HOME/.pi/agent)
  PI_AGENT_MIRROR             Sanitized mirror dir (default: $HOME/.cache/wedding-planner/pi-agent)
  PI_AUTH_CACHE               Shared Pi OAuth cache dir (default: $HOME/.cache/wedding-planner/pi-auth)
  SBX_CONFIG_DIR              Generated wrapper config dir (default: $HOME/.cache/wedding-planner/sbx-config)
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if ! command -v git >/dev/null 2>&1; then
  echo "git is required" >&2
  exit 1
fi

if ! command -v sbx >/dev/null 2>&1; then
  echo "sbx is required" >&2
  exit 1
fi

quote_for_sh() {
  local value="$1"
  printf "'"
  printf "%s" "$value" | sed "s/'/'\\''/g"
  printf "'"
}

has_custom_secret() {
  local target="$1"
  local env_name="$2"
  local placeholder="$3"

  awk -v target="$target" -v env_name="$env_name" -v placeholder="$placeholder" '
    $2 == target && $3 == env_name && $4 == placeholder { found = 1 }
    END { exit(found ? 0 : 1) }
  ' <<<"$SECRET_LIST"
}

check_custom_secrets() {
  if [[ "$SBX_SKIP_SECRET_PREFLIGHT" == "1" ]]; then
    return 0
  fi

  SECRET_LIST="$(sbx secret ls -g 2>/dev/null || true)"
  missing=()

  if ! has_custom_secret "api.vercel.com" "VERCEL_TOKEN" "$SBX_VERCEL_PLACEHOLDER"; then
    missing+=("Vercel")
  fi

  if ! has_custom_secret "api.supabase.com" "SUPABASE_ACCESS_TOKEN" "$SBX_SUPABASE_PLACEHOLDER"; then
    missing+=("Supabase")
  fi

  if (( ${#missing[@]} == 0 )); then
    return 0
  fi

  cat >&2 <<EOF
Missing Docker custom secret(s): ${missing[*]}

Configure them once on the host, then recreate any existing sandbox so the
placeholder env vars are injected:

  sbx secret set-custom -g --host api.vercel.com --env VERCEL_TOKEN \\
    --placeholder $SBX_VERCEL_PLACEHOLDER

  sbx secret set-custom -g --host api.supabase.com --env SUPABASE_ACCESS_TOKEN \\
    --placeholder $SBX_SUPABASE_PLACEHOLDER

Do not pass the real token with --value unless you accept it being visible in
shell history; let sbx prompt for the secret instead.
EOF
  exit 1
}

check_custom_secrets

rm -rf "$PI_AGENT_MIRROR"
mkdir -p "$PI_AGENT_MIRROR" "$PI_AUTH_CACHE" "$SBX_CONFIG_DIR"
chmod 700 "$PI_AUTH_CACHE" "$SBX_CONFIG_DIR" 2>/dev/null || true

copy_dir() {
  local name="$1"
  if [[ -d "$PI_AGENT_SRC/$name" ]]; then
    mkdir -p "$(dirname "$PI_AGENT_MIRROR/$name")"
    cp -a "$PI_AGENT_SRC/$name" "$PI_AGENT_MIRROR/$name"
  fi
}

copy_file() {
  local name="$1"
  if [[ -f "$PI_AGENT_SRC/$name" ]]; then
    cp "$PI_AGENT_SRC/$name" "$PI_AGENT_MIRROR/$name"
  fi
}

# Copy user-level Pi resources and configuration, but intentionally do not copy
# auth.json, sessions, or run-history.jsonl into the read-only resource mirror.
# OAuth auth is handled through PI_AUTH_CACHE, which is deliberately narrower and
# read-write so Pi can refresh ChatGPT/Codex tokens across new sandboxes.
for name in extensions skills prompts themes prompt-templates bin git npm; do
  copy_dir "$name"
done

for name in settings.json models.json AGENTS.md APPEND_SYSTEM.md; do
  copy_file "$name"
done

{
  echo "# Generated by sbx/pi-wedding-planner/run.sh."
  printf 'WP_PI_AUTH_CACHE=%s\n' "$(quote_for_sh "$PI_AUTH_CACHE")"
  printf 'WP_VERCEL_SCOPE=%s\n' "$(quote_for_sh "$SBX_VERCEL_SCOPE")"
  printf 'WP_VERCEL_PROJECT=%s\n' "$(quote_for_sh "$SBX_VERCEL_PROJECT")"
  printf 'WP_SUPABASE_PROJECT_REF=%s\n' "$(quote_for_sh "$SBX_SUPABASE_PROJECT_REF")"
  printf 'WP_VERCEL_PLACEHOLDER=%s\n' "$(quote_for_sh "$SBX_VERCEL_PLACEHOLDER")"
  printf 'WP_SUPABASE_PLACEHOLDER=%s\n' "$(quote_for_sh "$SBX_SUPABASE_PLACEHOLDER")"
} > "$SBX_CONFIG_DIR/sandbox.env"

GIT_COMMON_DIR="$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir)"

branch_args=()
if [[ "$SBX_BRANCH" != "none" ]]; then
  branch_args=(--branch "$SBX_BRANCH")
fi

exec sbx run \
  "${branch_args[@]}" \
  --kit "$REPO_ROOT/sbx/pi-wedding-planner" \
  pi-wedding-planner \
  "$REPO_ROOT" \
  "$GIT_COMMON_DIR" \
  "$PI_AGENT_MIRROR:ro" \
  "$PI_AUTH_CACHE" \
  "$SBX_CONFIG_DIR:ro" \
  "$@"
