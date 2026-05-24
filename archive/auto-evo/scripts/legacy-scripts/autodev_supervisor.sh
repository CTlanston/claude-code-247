#!/usr/bin/env bash
# autodev_supervisor.sh — long-running AutoDev v3 supervisor.
#
# Acquires a flock to prevent two supervisors from running at once. Runs
# `autodev_once.sh` every $AUTODEV_INTERVAL_SECONDS (default 900s).
#
# Stop with: Ctrl-C, `kill <pid>`, or `touch state/PAUSED`.
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a; . ./.env; set +a
fi

LOCK="$ROOT/state/.autodev_supervisor.lock"
mkdir -p "$ROOT/state"
INTERVAL="${AUTODEV_INTERVAL_SECONDS:-900}"

if [[ ! "${AUTODEV_LIVE:-0}" == "1" ]]; then
  echo "[autodev_supervisor] AUTODEV_LIVE != 1 — running in dry-run mode (set AUTODEV_LIVE=1 to enable real runs)"
fi

# Lock + run loop.
exec 200>"$LOCK"
if ! flock -n 200; then
  echo "[autodev_supervisor] another supervisor is already running (lock: $LOCK)"
  exit 3
fi

trap 'echo "[autodev_supervisor] interrupted, exiting"; exit 0' INT TERM

while true; do
  echo "[autodev_supervisor] cycle start at $(date -u +%FT%TZ)"
  if [[ -f state/PAUSED ]]; then
    echo "[autodev_supervisor] state/PAUSED present — sleeping"
    sleep "$INTERVAL"
    continue
  fi
  bash "$ROOT/scripts/autodev_once.sh" || true
  echo "[autodev_supervisor] sleeping $INTERVAL s"
  sleep "$INTERVAL"
done
