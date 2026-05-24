#!/usr/bin/env bash
# Install the claude-code-247 launchd jobs:
#   com.claude247.dashboard    keep-alive uvicorn on 127.0.0.1:8423
#   com.claude247.orchestrator periodic poll/heartbeat (every 60s)
#
# Idempotent: re-run to refresh after config changes.
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TPL_DIR="$REPO_ROOT/scripts/launchd"
DEST_DIR="$HOME/Library/LaunchAgents"
STATE_DIR="$HOME/.claude-code-247"
LOG_DIR="$STATE_DIR/logs"

mkdir -p "$DEST_DIR" "$STATE_DIR" "$LOG_DIR"

CLAUDE247_BIN="${CLAUDE247_BIN:-$REPO_ROOT/.venv/bin/claude247}"
UVICORN_BIN="${UVICORN_BIN:-$REPO_ROOT/.venv/bin/uvicorn}"
if [[ ! -x "$CLAUDE247_BIN" ]]; then
  echo "claude247 binary not found at $CLAUDE247_BIN" >&2
  echo "run 'make install' first to create the venv." >&2
  exit 2
fi
if [[ ! -x "$UVICORN_BIN" ]]; then
  echo "uvicorn binary not found at $UVICORN_BIN" >&2
  exit 2
fi

PATH_FOR_LAUNCHD="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/Users/${USER}/Library/pnpm/nodejs/20.20.2/bin"

render() {
  local tpl="$1" dest="$2"
  sed \
    -e "s|@CLAUDE247_BIN@|$CLAUDE247_BIN|g" \
    -e "s|@UVICORN_BIN@|$UVICORN_BIN|g" \
    -e "s|@REPO_ROOT@|$REPO_ROOT|g" \
    -e "s|@HOME@|$HOME|g" \
    -e "s|@PATH@|$PATH_FOR_LAUNCHD|g" \
    "$tpl" > "$dest"
}

for name in com.claude247.dashboard com.claude247.orchestrator; do
  src="$TPL_DIR/${name}.plist.tpl"
  dest="$DEST_DIR/${name}.plist"
  render "$src" "$dest"
  if launchctl list "$name" >/dev/null 2>&1; then
    launchctl unload "$dest" 2>/dev/null || true
  fi
  launchctl load -w "$dest"
  echo "installed $dest"
done

echo
echo "claude247 launchd jobs loaded."
echo "  dashboard: http://127.0.0.1:8423"
echo "  logs:      $LOG_DIR/{dashboard,orchestrator}.{out,err}.log"
echo
echo "uninstall with: scripts/uninstall_launchd.sh"
