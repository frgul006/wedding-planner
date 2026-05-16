#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
cd "$repo_root"

limit="${1:-${RALPH_ISSUE_LIMIT:-20}}"
search='label:"ready-for-agent" -label:"agent-in-progress" -label:prd'

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required to fetch GitHub issues" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required to format GitHub issues" >&2
  exit 1
fi

issues_json=$(gh issue list \
  --state open \
  --search "$search" \
  --limit "$limit" \
  --json number)

numbers=$(jq -r '.[].number' <<<"$issues_json")

if [[ -z "$numbers" ]]; then
  echo "No open GitHub implementation issues labeled ready-for-agent without agent-in-progress."
  exit 0
fi

for number in $numbers; do
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
          "# Issue #\(.number): \(.title)",
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
done
