#!/usr/bin/env bash
# autodev_once.sh — run exactly one AutoDev v3 supervisor cycle.
#
# Flags:
#   --dry-run   pass through to supervisor; never invokes the inner engine
#               for real.
#   --report    force a report-only cycle.
#
# Env vars honoured:
#   AUTODEV_LIVE=1                 caller asserts live mode is OK (still
#                                  requires runtime.live_allowed in state)
#   AUTODEV_MODE=cheap|balanced|premium
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a; . ./.env; set +a
fi

ARGS=("--once")
for arg in "$@"; do
  case "$arg" in
    --dry-run) ARGS+=("--dry-run") ;;
    --report)  ARGS+=("--report") ;;
    *)         ARGS+=("$arg") ;;
  esac
done

# If AUTODEV_LIVE=1 was not set, treat as dry-run unconditionally.
if [[ "${AUTODEV_LIVE:-0}" != "1" ]]; then
  if [[ ! " ${ARGS[*]} " =~ " --dry-run " ]]; then
    ARGS+=("--dry-run")
  fi
fi

exec python3 -m autodev.supervisor "${ARGS[@]}"
