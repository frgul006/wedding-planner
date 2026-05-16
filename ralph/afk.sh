#!/usr/bin/env bash
set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "Usage: $0 <iterations>"
  exit 1
fi

# jq filter to extract streaming text deltas from pi's JSON event stream.
stream_text='select(.type == "message_update" and .assistantMessageEvent.type == "text_delta") | .assistantMessageEvent.delta'

# jq filter to extract the final assistant message from pi's JSON event stream.
final_result='select(.type == "agent_end") | (.messages | map(select(.role == "assistant")) | last | .content // [] | map(select(.type == "text") | .text) | join(""))'

tmpfiles=()
cleanup() {
  rm -f "${tmpfiles[@]}"
}
trap cleanup EXIT

for ((i=1; i<=$1; i++)); do
  tmpfile=$(mktemp)
  tmpfiles+=("$tmpfile")

  commits=$(git log -n 5 --format="%H%n%ad%n%B---" --date=short 2>/dev/null || echo "No commits found")
  issues=$(cat issues/*.md 2>/dev/null || echo "No issues found")
  prompt=$(cat ralph/prompt.md)

  pi \
    --verbose \
    --mode json \
    "Previous commits: $commits Issues: $issues $prompt" \
  | grep --line-buffered '^{' \
  | tee "$tmpfile" \
  | jq --unbuffered -rj "$stream_text"

  echo

  result=$(jq -r "$final_result" "$tmpfile")

  if [[ "$result" == *"<promise>NO MORE TASKS</promise>"* ]]; then
    echo "Ralph complete after $i iterations."
    exit 0
  fi
done
