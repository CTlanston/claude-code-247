#!/usr/bin/env bash
# autodev_status.sh — compact status from state.json + tasks/current.md + recent reports.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

STATE="$ROOT/reports/state.json"
HEART="$ROOT/reports/heartbeat.json"
CURRENT="$ROOT/tasks/current.md"
HOLD="$ROOT/reports/human-hold.md"

echo "=== AutoDev status @ $(date -u +%FT%TZ) ==="
echo

if [[ -f "$STATE" ]]; then
  python3 - <<'PY'
import json, pathlib
p = pathlib.Path("reports/state.json")
s = json.loads(p.read_text())
keys = [
    "mode","status","paused","live_allowed","autostart_allowed",
    "current_task_id","current_task_title","current_phase","branch",
    "last_test_result","last_ci_result","last_guardian_result",
    "blocked","blocker_reason","human_needed",
    "cost_mode","api_spend_today_usd","health_status","updated_at",
]
for k in keys:
    print(f"  {k:<28s} {s.get(k)}")
PY
else
  echo "  state.json missing — run autodev_doctor.sh"
fi

echo
echo "=== Heartbeat ==="
[[ -f "$HEART" ]] && cat "$HEART" || echo "  (none)"

echo
echo "=== Current task ==="
[[ -f "$CURRENT" ]] && cat "$CURRENT" || echo "  (none)"

echo
echo "=== Hold items (titles only) ==="
if [[ -f "$HOLD" ]]; then
  grep -E '^## HOLD-' "$HOLD" || echo "  (no hold items)"
else
  echo "  (none)"
fi

echo
echo "=== Tail of session log ==="
[[ -f "$ROOT/reports/session-log.md" ]] && tail -12 "$ROOT/reports/session-log.md" || true
