#!/usr/bin/env bash
# stop_summary.sh — Claude Code "Stop" hook.
#
# Append a stop timestamp + last-cycle summary to reports/session-log.md so
# the next supervisor cycle has a quick "what was the last session doing" trail.
# Light-weight — DO NOT run tests or anything slow here.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG="$ROOT/reports/session-log.md"

mkdir -p "$ROOT/reports"
ts=$(date -u +%FT%TZ)
status="$(python3 -c "import json; s=json.load(open('$ROOT/reports/state.json')); print(s.get('status','?'))" 2>/dev/null || echo unknown)"
task="$(python3 -c "import json; s=json.load(open('$ROOT/reports/state.json')); print(s.get('current_task_id','-'))" 2>/dev/null || echo -)"

cat >> "$LOG" <<EOF

- ${ts}  session.stop  status=${status}  task=${task}
EOF

exit 0
