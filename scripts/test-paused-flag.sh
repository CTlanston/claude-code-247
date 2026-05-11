#!/usr/bin/env bash
# Verify the PAUSED kill-switch: touching $STATE_DIR/PAUSED freezes dispatch
# even if everything else is healthy.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

pkill -f 'main.py' 2>/dev/null || true
sleep 1
rm -rf /tmp/auto-evo-playground /tmp/auto-evo-playground.git /tmp/claude-247-workspaces ~/.claude-247-state

set -a
. ./.env
set +a
export ORCHESTRATOR_POLL_INTERVAL_SECONDS=3
export STATE_DIR="${STATE_DIR:-$HOME/.claude-247-state}"
export WORKSPACE_ROOT="${WORKSPACE_ROOT:-/tmp/claude-247-workspaces}"
mkdir -p "$STATE_DIR" "$WORKSPACE_ROOT"

( cd orchestrator && python3 -u main.py ) > /tmp/orchestrator-paused.log 2>&1 &
ORCH_PID=$!
sleep 3

# Mark this as a human-initiated pause so guardian can't auto-clear it.
touch "$STATE_DIR/PAUSED"
touch "$STATE_DIR/PAUSED.human"

echo "[test] PAUSED flag set. Injecting issue #888 — should NOT advance."
bash scripts/inject-issue.sh 888 "should be frozen"

# Wait through several poll cycles.
for i in 1 2 3 4 5; do
  sleep 3
  STATUS=$(sqlite3 "$STATE_DIR/orchestrator.db" "SELECT status FROM tasks WHERE issue_id=888;" 2>/dev/null || true)
  echo "  poll $i: status='${STATUS:-absent}'"
done

echo "[test] removing PAUSED flag — orchestrator should resume"
rm -f "$STATE_DIR/PAUSED" "$STATE_DIR/PAUSED.human"

for i in 1 2 3 4; do
  sleep 3
  STATUS=$(sqlite3 "$STATE_DIR/orchestrator.db" "SELECT status FROM tasks WHERE issue_id=888;" 2>/dev/null || true)
  echo "  poll $i: status='${STATUS:-absent}'"
  if [[ "$STATUS" == "human_review" ]]; then
    break
  fi
done

kill $ORCH_PID 2>/dev/null || true
sleep 1

echo
echo "===== orchestrator log (last 25) ====="
tail -25 /tmp/orchestrator-paused.log

echo
echo "===== assertions ====="
PASS=1
if grep -q "dispatch paused (flag=" /tmp/orchestrator-paused.log; then
  echo "  ✓ orchestrator logged 'dispatch paused (flag=...)'"
else
  echo "  ✗ no 'dispatch paused' line"
  PASS=0
fi
FINAL_STATUS=$(sqlite3 "$STATE_DIR/orchestrator.db" "SELECT status FROM tasks WHERE issue_id=888;" 2>/dev/null || true)
if [[ "$FINAL_STATUS" == "human_review" ]]; then
  echo "  ✓ issue #888 reached human_review after PAUSED removed (status=$FINAL_STATUS)"
else
  echo "  ✗ issue #888 final status='${FINAL_STATUS:-absent}' (expected human_review)"
  PASS=0
fi

if [[ "$PASS" == "1" ]]; then
  echo
  echo "[test] PASS — PAUSED kill-switch works"
  exit 0
else
  echo
  echo "[test] FAIL"
  exit 1
fi
