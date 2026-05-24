#!/usr/bin/env bash
# Validate the TDD gate: a Coder run that produces ONLY a `feat:` commit must be
# rejected by Reviewer. Asserts state machine bounces issue back to coding,
# decrements credit, increments review_rounds.
#
# Usage: ./scripts/test-tdd-gate.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "[test] resetting local state"
pkill -f 'main.py' 2>/dev/null || true
rm -rf /tmp/auto-evo-playground /tmp/auto-evo-playground.git /tmp/claude-247-workspaces ~/.claude-247-state

set -a
. ./.env
set +a
export ORCHESTRATOR_POLL_INTERVAL_SECONDS=3
export STATE_DIR="${STATE_DIR:-$HOME/.claude-247-state}"
export WORKSPACE_ROOT="${WORKSPACE_ROOT:-/tmp/claude-247-workspaces}"
mkdir -p "$STATE_DIR" "$WORKSPACE_ROOT"

# Force the stub coder to skip the test commit so the TDD gate trips.
export STUB_CODER_SKIP_TEST=1

echo "[test] starting orchestrator with STUB_CODER_SKIP_TEST=1"
( cd orchestrator && python3 -u main.py ) > /tmp/orchestrator-tdd.log 2>&1 &
ORCH_PID=$!

# Wait for it to come up.
sleep 3

echo "[test] injecting issue #99"
bash scripts/inject-issue.sh 99 "add reverse(s) to utils.py with tests" "Implement reverse(s)."

# Watch the loop for ~25 seconds — three coding/reviewing rounds plus the human-review trip.
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 3
  STATUS=$(sqlite3 "$STATE_DIR/orchestrator.db" "SELECT status FROM tasks WHERE issue_id=99;" 2>/dev/null || echo "?")
  ROUNDS=$(sqlite3 "$STATE_DIR/orchestrator.db" "SELECT review_rounds FROM tasks WHERE issue_id=99;" 2>/dev/null || echo "?")
  CREDIT=$(sqlite3 "$STATE_DIR/orchestrator.db" "SELECT credit FROM tasks WHERE issue_id=99;" 2>/dev/null || echo "?")
  echo "  poll $i: status=$STATUS rounds=$ROUNDS credit=$CREDIT"
  if [[ "$STATUS" == "human_review" ]]; then
    break
  fi
done

echo "[test] stopping orchestrator (pid $ORCH_PID)"
kill "$ORCH_PID" 2>/dev/null || true
sleep 1

echo
echo "===== last 40 lines of orchestrator log ====="
tail -40 /tmp/orchestrator-tdd.log
echo
echo "===== final task row ====="
sqlite3 "$STATE_DIR/orchestrator.db" -header -column "SELECT issue_id, status, review_rounds, credit, last_error FROM tasks WHERE issue_id=99;"
echo
echo "===== audit trail (credit deducts + guardian) ====="
sqlite3 "$STATE_DIR/orchestrator.db" -header -column "SELECT actor, action, substr(detail,1,80) AS detail FROM audit ORDER BY id DESC LIMIT 10;"
echo
echo "===== assertions ====="
FINAL_STATUS=$(sqlite3 "$STATE_DIR/orchestrator.db" "SELECT status FROM tasks WHERE issue_id=99;")
ROUNDS=$(sqlite3 "$STATE_DIR/orchestrator.db" "SELECT review_rounds FROM tasks WHERE issue_id=99;")
CREDIT=$(sqlite3 "$STATE_DIR/orchestrator.db" "SELECT credit FROM tasks WHERE issue_id=99;")

PASS=1
[[ "$FINAL_STATUS" == "human_review" ]] && echo "  ✓ status=human_review" || { echo "  ✗ status=$FINAL_STATUS"; PASS=0; }
[[ "$ROUNDS" -ge 3 ]] && echo "  ✓ review_rounds=$ROUNDS (>=3)" || { echo "  ✗ review_rounds=$ROUNDS"; PASS=0; }
[[ "$CREDIT" -lt 100 ]] && echo "  ✓ credit=$CREDIT (deducted)" || { echo "  ✗ credit=$CREDIT"; PASS=0; }

# Look for the agent:human-review label on the PR.
LABEL=$(grep -h 'agent:human-review' /tmp/claude-247-workspaces/_github_stub/prs/*.json 2>/dev/null || true)
[[ -n "$LABEL" ]] && echo "  ✓ PR labelled agent:human-review" || { echo "  ✗ no agent:human-review PR label"; PASS=0; }

if [[ "$PASS" == "1" ]]; then
  echo
  echo "[test] PASS — TDD gate works end-to-end"
  exit 0
else
  echo
  echo "[test] FAIL"
  exit 1
fi
