#!/usr/bin/env bash
# Inject a fake issue into the orchestrator queue.
#   LOCAL_MODE=1: write into the GitHub stub directory so the next ingest pass picks it up.
#   else: write directly into the SQLite tasks table (skips ingest).
# Usage: ./scripts/inject-issue.sh <issue_id> "<title>" ["<body>"]
set -euo pipefail

ID="${1:?usage: inject-issue.sh ID TITLE [BODY]}"
TITLE="${2:?usage: inject-issue.sh ID TITLE [BODY]}"
BODY="${3:-}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

set -a
. ./.env
set +a

if [[ "${LOCAL_MODE:-0}" == "1" ]]; then
  WS="${WORKSPACE_ROOT:-/tmp/claude-247-workspaces}"
  STUB_DIR="$WS/_github_stub/issues"
  mkdir -p "$STUB_DIR"
  jq -n --argjson n "$ID" --arg t "$TITLE" --arg b "$BODY" \
    '{number:$n, title:$t, body:$b, state:"open", labels:["agent:auto"]}' \
    > "$STUB_DIR/$ID.json"
  echo "[inject] LOCAL_MODE — wrote $STUB_DIR/$ID.json"
  echo "Orchestrator will ingest on next poll. Tail logs to watch."
else
  STATE="${STATE_DIR:-/state}"
  DB="$STATE/orchestrator.db"
  if [[ ! -f "$DB" ]]; then
    echo "state DB not found at $DB. Run scripts/setup.sh first."
    exit 1
  fi
  PLAN_JSON=$(jq -n --arg t "$TITLE" --arg b "$BODY" '{title:$t, body:$b}')
  sqlite3 "$DB" <<SQL
INSERT OR REPLACE INTO tasks
  (issue_id, repo, status, credit, plan_json, created_at, updated_at)
VALUES
  ($ID, 'local/inject', 'queued', 100, '$PLAN_JSON', strftime('%s','now'), strftime('%s','now'));
SQL
  echo "[inject] direct DB — issue #$ID queued"
fi
