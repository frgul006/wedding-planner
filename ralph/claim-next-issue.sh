#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
cd "$repo_root"

search='label:"ready-for-agent" -label:"agent-in-progress" -label:prd'
git_common_dir="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || printf '%s' "$repo_root")"
lock_dir="$git_common_dir/ralph-claim.lock"
mkdir -p "$(dirname "$lock_dir")"
claimed=0
number=""

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required to claim GitHub issues" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required to format GitHub issues" >&2
  exit 1
fi

locked=0
for ((attempt=1; attempt<=30; attempt++)); do
  if mkdir "$lock_dir" 2>/dev/null; then
    locked=1
    break
  fi
  sleep 1
done

if [[ "$locked" != "1" ]]; then
  echo "Could not acquire Ralph issue-claim lock at $lock_dir" >&2
  exit 1
fi

cleanup() {
  status=$?
  if [[ "$status" -ne 0 && "$claimed" == "1" && -n "$number" ]]; then
    gh issue edit "$number" --remove-label agent-in-progress >/dev/null 2>&1 || true
  fi
  rmdir "$lock_dir" 2>/dev/null || true
}
trap cleanup EXIT

number=$(gh issue list \
  --state open \
  --search "$search" \
  --limit 1 \
  --json number \
  --jq '.[0].number // empty')

if [[ -z "$number" ]]; then
  echo "No open GitHub implementation issues labeled ready-for-agent without agent-in-progress."
  exit 0
fi

gh issue edit "$number" --add-label agent-in-progress >/dev/null
claimed=1

gh issue view "$number" \
  --comments \
  --json number,title,body,labels,comments,state,author,createdAt,updatedAt,url \
| jq -r '
    def login($author):
      if $author == null then "unknown"
      else ($author.login // $author.name // "unknown")
      end;

    (.labels | map(.name) | join(", ")) as $labels
    | [
        "# Claimed Issue #\(.number): \(.title)",
        "",
        "- URL: \(.url)",
        "- State: \(.state)",
        "- Author: @\(login(.author))",
        "- Labels: \(if $labels == "" then "None" else $labels end)",
        "- Created: \(.createdAt)",
        "- Updated: \(.updatedAt)",
        "",
        "## Body",
        "",
        ((.body // "") | if . == "" then "_No body._" else . end),
        "",
        "## Comments",
        "",
        (if (.comments | length) == 0 then
          "_No comments._"
        else
          (.comments | map("### @\(login(.author)) at \(.createdAt)\n\n\(.body // "")") | join("\n\n"))
        end),
        "",
        "---",
        ""
      ]
    | join("\n")
  '
