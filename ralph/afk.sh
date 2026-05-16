#!/usr/bin/env bash
set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "Usage: $0 <iterations>"
  exit 1
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
cd "$repo_root"

# jq filter to extract streaming text deltas from pi's JSON event stream.
stream_text='select(.type == "message_update" and .assistantMessageEvent.type == "text_delta") | .assistantMessageEvent.delta'

# jq filter to extract the final assistant message from pi's JSON event stream.
final_result='select(.type == "agent_end") | (.messages | map(select(.role == "assistant")) | last | .content // [] | map(select(.type == "text") | .text) | join(""))'

tmpfiles=()
claimed_issue_number=""
cleanup() {
  status=$?
  rm -f "${tmpfiles[@]}"
  if [[ "$status" -ne 0 && -n "${claimed_issue_number:-}" ]]; then
    gh issue edit "$claimed_issue_number" --remove-label agent-in-progress >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

for ((i=1; i<=$1; i++)); do
  tmpfile=$(mktemp)
  tmpfiles+=("$tmpfile")

  claimed_issue_number=""
  issues=$("$script_dir/claim-next-issue.sh")

  if [[ "$issues" == "No open GitHub implementation issues"* ]]; then
    echo "$issues"
    echo "Ralph complete after $((i - 1)) iterations."
    exit 0
  fi

  claimed_issue_number=$(printf '%s\n' "$issues" | sed -nE 's/^# Claimed Issue #([0-9]+):.*/\1/p' | head -n 1)

  commits=$(git log -n 5 --format="%H%n%ad%n%B---" --date=short 2>/dev/null || echo "No commits found")
  prompt=$(cat ralph/prompt.md)

  pi \
    --verbose \
    --mode json \
    "$(cat <<EOF
Previous commits:
$commits

Claimed GitHub ready-for-agent issue:
$issues

$prompt
EOF
)" \
  | grep --line-buffered '^{' \
  | tee "$tmpfile" \
  | jq --unbuffered -rj "$stream_text"

  echo

  result=$(jq -r "$final_result" "$tmpfile")
  claimed_issue_number=""

  if [[ "$result" == *"<promise>NO MORE TASKS</promise>"* ]]; then
    echo "Ralph complete after $i iterations."
    exit 0
  fi
done
