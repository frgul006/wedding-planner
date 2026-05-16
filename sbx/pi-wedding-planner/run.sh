#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PI_AGENT_SRC="${PI_AGENT_SRC:-$HOME/.pi/agent}"
PI_AGENT_MIRROR="${PI_AGENT_MIRROR:-$HOME/.cache/wedding-planner/pi-agent}"
SBX_BRANCH="${SBX_BRANCH:-auto}"

usage() {
  cat <<'EOF'
Usage: sbx/pi-wedding-planner/run.sh [-- AGENT_ARGS...]

Creates/runs the pi-wedding-planner sandbox with:
  - git metadata mounted so worktree sandboxes are real git repos
  - a sanitized copy of user-level Pi resources mounted read-only

Environment:
  SBX_BRANCH       Branch for sbx --branch (default: auto; set to none to disable)
  PI_AGENT_SRC     Host Pi agent dir (default: $HOME/.pi/agent)
  PI_AGENT_MIRROR  Sanitized mirror dir (default: $HOME/.cache/wedding-planner/pi-agent)
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

rm -rf "$PI_AGENT_MIRROR"
mkdir -p "$PI_AGENT_MIRROR"

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
# auth.json, sessions, or run-history.jsonl into the mount shared with sandboxed agents.
for name in extensions skills prompts themes prompt-templates bin git npm; do
  copy_dir "$name"
done

for name in settings.json models.json AGENTS.md APPEND_SYSTEM.md; do
  copy_file "$name"
done

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
  "$@"
