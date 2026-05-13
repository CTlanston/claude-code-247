#!/usr/bin/env bash
# autodev_status_dashboard.sh — read-only one-screen operator status.
#
# Usage:
#   bash scripts/autodev_status_dashboard.sh
#
# Emits a structured status report:
#   - Overall Level (from LEVEL.md)
#   - Per-dim (from LEVEL.md, the M/S/R/C/T/E table)
#   - C Streak (from reports/zero-deadlock-streak.txt; current/30)
#   - Last 5 cycles (tail of CHANGELOG.md)
#   - Stop conditions (AUTODEV_DONE / STOPSWITCH / BLOCKED / rate-limit)
#   - Last 5 wake events (tail of reports/runs/launchd.log)
#   - launchctl registration for both L7 and v3 agents
#
# Always exits 0. This is a read-only diagnostic command.
#
# Env knobs (for tests/non-standard invocations):
#   AUTODEV_REPO_ROOT             repo path; default: script's parent of parent
#   AUTODEV_DASHBOARD_DRY_RUN     if non-empty, skip launchctl calls

set -u

# --- Configuration -----------------------------------------------------

if [[ -z "${AUTODEV_REPO_ROOT:-}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  AUTODEV_REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
fi
REPO="${AUTODEV_REPO_ROOT}"
DRY_RUN="${AUTODEV_DASHBOARD_DRY_RUN:-}"

cd "$REPO" 2>/dev/null || true

# --- Output ------------------------------------------------------------

echo "=== AutoDev L7 Status @ $(date -u +%FT%TZ) ==="
echo "(repo: $REPO)"
echo

# --- Overall Level ---
echo "-- Overall Level --"
if [[ -f LEVEL.md ]]; then
  grep '^Overall L' LEVEL.md 2>/dev/null || echo "  (LEVEL.md has no Overall L line)"
else
  echo "  (LEVEL.md missing — run scripts/compute_level.py)"
fi
echo

# --- Per-dim levels (the rubric line-per-dim table) ---
echo "-- Per-dim --"
if [[ -f LEVEL.md ]]; then
  # Lines starting with M/S/R/C/T/E plus space and a digit — the dim
  # table. Robust against extra blank lines / preamble changes.
  grep -E '^[MSRCTE] [0-9]' LEVEL.md || head -8 LEVEL.md
else
  echo "  (LEVEL.md missing)"
fi
echo

# --- C Streak ---
echo "-- C Streak --"
if [[ -f reports/zero-deadlock-streak.txt ]]; then
  streak=$(cat reports/zero-deadlock-streak.txt | tr -d '[:space:]')
  if [[ -n "$streak" ]]; then
    remaining=$((30 - streak))
    if (( remaining < 0 )); then remaining=0; fi
    echo "  current=${streak}/30   ${remaining} more cycles to C-L5"
  else
    echo "  (streak file empty)"
  fi
else
  echo "  (no streak yet — reports/zero-deadlock-streak.txt missing)"
fi
echo

# --- Last 5 cycles (from CHANGELOG) ---
echo "-- Last 5 cycles --"
if [[ -f CHANGELOG.md ]]; then
  tail -5 CHANGELOG.md
else
  echo "  (CHANGELOG.md missing)"
fi
echo

# --- Stop conditions ---
echo "-- Stop conditions --"
stop_any=0
if [[ -f reports/AUTODEV_DONE.md ]]; then
  echo "  ✓ reports/AUTODEV_DONE.md present — mission complete"
  stop_any=1
fi
if [[ -f reports/STOPSWITCH ]]; then
  echo "  ⚠ reports/STOPSWITCH present — human halt active"
  stop_any=1
fi
if [[ -f BLOCKED.md ]]; then
  echo "  ⚠ BLOCKED.md present — blocked"
  stop_any=1
fi
if [[ -f reports/quota-rate-limit-until.ts ]]; then
  until_ts=$(cat reports/quota-rate-limit-until.ts | tr -d '[:space:]')
  if [[ -n "$until_ts" ]]; then
    now=$(date -u +%s)
    if (( until_ts > now )); then
      remaining=$((until_ts - now))
      mins=$((remaining / 60))
      echo "  ⚠ reports/quota-rate-limit-until.ts active — ${mins} min remaining"
      stop_any=1
    fi
  fi
fi
if (( stop_any == 0 )); then
  echo "  (none active — cycle dispatch will fire on next wake)"
fi
echo

# --- Last 5 wake events ---
echo "-- Last 5 wake events --"
if [[ -f reports/runs/launchd.log ]]; then
  tail -5 reports/runs/launchd.log
else
  echo "  (no launchd log yet — reports/runs/launchd.log missing)"
fi
echo

# --- launchctl registration ---
echo "-- launchctl registration --"
if [[ -n "$DRY_RUN" ]]; then
  echo "  [dry-run] skipped"
else
  l7_line=$(launchctl list 2>/dev/null | grep "com.lanston.autodev.continuous" || true)
  v3_line=$(launchctl list 2>/dev/null | grep "com.autodev.supervisor" || true)
  if [[ -n "$l7_line" ]]; then
    echo "  L7 continuous: $l7_line"
  else
    echo "  L7 continuous: not loaded (run scripts/install_launchd_continuous.sh --install)"
  fi
  if [[ -n "$v3_line" ]]; then
    echo "  v3 supervisor: $v3_line"
  else
    echo "  v3 supervisor: not loaded"
  fi
fi
echo

exit 0
