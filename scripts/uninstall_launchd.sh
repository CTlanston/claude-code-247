#!/usr/bin/env bash
# Uninstall the claude-code-247 launchd jobs. Leaves logs and plists
# in place unless --purge is passed.
set -Eeuo pipefail

PURGE=0
if [[ "${1:-}" == "--purge" ]]; then
  PURGE=1
fi

DEST_DIR="$HOME/Library/LaunchAgents"

for name in com.claude247.dashboard com.claude247.orchestrator com.claude247.dispatcher com.claude247.backup; do
  dest="$DEST_DIR/${name}.plist"
  if [[ -f "$dest" ]]; then
    launchctl unload "$dest" 2>/dev/null || true
    if [[ $PURGE -eq 1 ]]; then
      rm -f "$dest"
      echo "removed $dest"
    else
      echo "unloaded $dest (file kept; re-run install_launchd.sh to bring back)"
    fi
  fi
done

if [[ $PURGE -eq 1 ]]; then
  rm -rf "$HOME/.claude-code-247/logs"
  echo "purged $HOME/.claude-code-247/logs"
fi
