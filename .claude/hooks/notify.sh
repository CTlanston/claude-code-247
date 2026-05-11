#!/usr/bin/env bash
# notify.sh — local + Slack notification when Claude needs input / a blocker fires.
#
# Called via Claude Code hooks (configured in `.claude/settings.local.json`).
# Reads `SLACK_WEBHOOK_URL` from .env if present. Failure to notify must NOT
# fail the main Claude session.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MSG="${1:-AutoDev v3 hook fired with no message}"

# Source .env if it exists. Silent on failure.
if [[ -f "$ROOT/.env" ]]; then
  set -a; . "$ROOT/.env" 2>/dev/null || true; set +a
fi

# Always log locally.
{
  ts=$(date -u +%FT%TZ)
  echo "[$ts] notify.sh: $MSG"
} >> "$ROOT/reports/notify.log" 2>/dev/null || true

# Slack — best effort.
if [[ -n "${SLACK_WEBHOOK_URL:-}" ]]; then
  payload=$(python3 - "$MSG" <<'PY' 2>/dev/null
import json, sys
print(json.dumps({"text": sys.argv[1][:1000]}))
PY
)
  curl -fsSL -X POST -H 'Content-Type: application/json' \
       -d "$payload" "$SLACK_WEBHOOK_URL" \
       >/dev/null 2>&1 || true
fi

# macOS local notification (best effort, no failure propagation).
if command -v osascript >/dev/null 2>&1; then
  osascript -e "display notification \"$MSG\" with title \"AutoDev v3\"" \
       2>/dev/null || true
fi

exit 0
