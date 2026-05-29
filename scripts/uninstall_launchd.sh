#!/usr/bin/env bash
# Unload the aedev daemon launchd agent. With --purge, also delete the plist
# and logs. State (DB + evidence under AEDEV_HOME) is never deleted here.
set -Eeuo pipefail

AEDEV_HOME="${AEDEV_HOME:-$HOME/.claude-code-247}"
PLIST="$HOME/Library/LaunchAgents/com.claude247.daemon.plist"

if [ -f "$PLIST" ]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  echo "unloaded com.claude247.daemon"
else
  echo "no plist at $PLIST (nothing loaded)"
fi

if [ "${1:-}" = "--purge" ]; then
  rm -f "$PLIST"
  rm -rf "$AEDEV_HOME/logs"
  echo "purged plist + logs (state DB under $AEDEV_HOME/state kept)"
fi
