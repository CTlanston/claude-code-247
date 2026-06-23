#!/usr/bin/env bash
# Unload the independent Claude<->Codex autoflow loop. Keeps state by default.
set -Eeuo pipefail

PLIST="$HOME/Library/LaunchAgents/com.claude247.autoflow.plist"
LABEL="com.claude247.autoflow"
AUTOFLOW_HOME="${AEDEV_AUTOFLOW_HOME:-$HOME/.claude-code-247/autoflow}"

launchctl unload "$PLIST" 2>/dev/null || true
launchctl remove "$LABEL" 2>/dev/null || true
echo "unloaded $LABEL"

if [ "${1:-}" = "--purge" ]; then
  rm -f "$PLIST"
  rm -rf "$AUTOFLOW_HOME/logs"
  echo "purged plist and logs; kept worktrees/evidence/state under $AUTOFLOW_HOME"
fi
