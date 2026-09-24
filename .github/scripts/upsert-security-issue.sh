#!/usr/bin/env bash
# Deterministic GitHub issue upsert for security / CI findings.
# Usage: upsert-security-issue.sh <title> <fingerprint> <body-markdown>
# Requires: gh, GH_TOKEN, GH_REPO
set -euo pipefail

TITLE="${1:?title required}"
FINGERPRINT="${2:?fingerprint required}"
BODY="${3:?body required}"

LABEL="${ISSUE_LABEL:-security}"

full_body="$(printf '%s\n\nFingerprint: `%s`\n' "$BODY" "$FINGERPRINT")"

# Title-primary match (fingerprint is a durable body marker, not a second key).
jq_title="${TITLE//\\/\\\\}"
jq_title="${jq_title//\"/\\\"}"

number="$(
  gh issue list --state open --search "${TITLE} in:title" --json number,title \
    --jq ".[] | select(.title == \"${jq_title}\") | .number" \
    | head -n1
)"

if [[ -n "${number}" ]]; then
  gh issue comment "$number" --body "$full_body"
  echo "Updated issue #${number}"
else
  # Label may not exist yet on a fresh repo — create best-effort.
  gh label create "$LABEL" --color B60205 --description "Security finding or hardening work" --force 2>/dev/null || true
  gh issue create --title "$TITLE" --body "$full_body" --label "$LABEL"
  echo "Created issue for fingerprint ${FINGERPRINT}"
fi
