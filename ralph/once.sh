#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
cd "$repo_root"

issues=$("$script_dir/claim-next-issue.sh")

if [[ "$issues" == "No open GitHub implementation issues"* ]]; then
  echo "$issues"
  echo "<promise>NO MORE TASKS</promise>"
  exit 0
fi

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
