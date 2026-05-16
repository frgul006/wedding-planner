#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
cd "$repo_root"

claimed_issue_number=""
cleanup_claim_on_failure() {
  status=$?
  if [[ "$status" -ne 0 && -n "${claimed_issue_number:-}" ]]; then
    gh issue edit "$claimed_issue_number" --remove-label agent-in-progress >/dev/null 2>&1 || true
  fi
}
trap cleanup_claim_on_failure EXIT

issues=$("$script_dir/claim-next-issue.sh")

if [[ "$issues" == "No open GitHub implementation issues"* ]]; then
  echo "$issues"
  echo "<promise>NO MORE TASKS</promise>"
  exit 0
fi

claimed_issue_number=$(printf '%s\n' "$issues" | sed -nE 's/^# Claimed Issue #([0-9]+):.*/\1/p' | head -n 1)

commits=$(git log -n 5 --format="%H%n%ad%n%B---" --date=short 2>/dev/null || echo "No commits found")
prompt=$(cat ralph/prompt.md)

pi "$(cat <<EOF
Previous commits:
$commits

Claimed GitHub ready-for-agent issue:
$issues

$prompt
EOF
)"
