#!/usr/bin/env bash
# Install the aedev TS daemon (port 7247) as a launchd user agent so it stays up
# 24/7 and restarts on crash + at login. Renders the plist from the template and
# validates it with plutil. Idempotent and SAFE: if a daemon job is already
# loaded it will NOT clobber the running daemon unless you pass --reload.
#
# Env overrides: AEDEV_HOME (default ~/.claude-code-247/aedev-daemon),
#                AEDEV_PNPM_BIN.
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PNPM_BIN="${AEDEV_PNPM_BIN:-$(command -v pnpm || true)}"
NODE_BIN="$(command -v node || true)"
AEDEV_HOME="${AEDEV_HOME:-$HOME/.claude-code-247/aedev-daemon}"
LOG_DIR="$AEDEV_HOME/logs"
ENTRY_REL="packages/daemon/src/main.ts"
TPL="$REPO_ROOT/scripts/launchd/com.claude247.daemon.plist.tpl"
LA_DIR="$HOME/Library/LaunchAgents"
PLIST="$LA_DIR/com.claude247.daemon.plist"
LABEL="com.claude247.daemon"
PORT="7247"

[ -n "$PNPM_BIN" ] || { echo "error: pnpm not found (set AEDEV_PNPM_BIN)" >&2; exit 1; }
[ -n "$NODE_BIN" ] || { echo "error: node not found on PATH" >&2; exit 1; }
[ -f "$TPL" ]                       || { echo "error: template missing: $TPL" >&2; exit 1; }
[ -f "$REPO_ROOT/$ENTRY_REL" ]      || { echo "error: daemon entry missing: $ENTRY_REL" >&2; exit 1; }
[ -d "$REPO_ROOT/node_modules" ]    || { echo "error: run 'pnpm install' first" >&2; exit 1; }

mkdir -p "$LOG_DIR" "$AEDEV_HOME/state" "$LA_DIR"
PNPM_DIR="$(dirname "$PNPM_BIN")"
NODE_DIR="$(dirname "$NODE_BIN")"
PATH_VAL="$PNPM_DIR:$NODE_DIR:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

sed -e "s#@@PNPM@@#${PNPM_BIN}#g" \
    -e "s#@@DAEMON_ENTRY@@#${ENTRY_REL}#g" \
    -e "s#@@REPO_ROOT@@#${REPO_ROOT}#g" \
    -e "s#@@LOG_DIR@@#${LOG_DIR}#g" \
    -e "s#@@HOME@@#${HOME}#g" \
    -e "s#@@PATH@@#${PATH_VAL}#g" \
    -e "s#@@AEDEV_HOME@@#${AEDEV_HOME}#g" \
    "$TPL" > "$PLIST"

if command -v plutil >/dev/null 2>&1; then
  plutil -lint "$PLIST" >/dev/null || { echo "error: rendered plist failed plutil -lint" >&2; exit 1; }
fi
echo "rendered + validated $PLIST"

if launchctl list 2>/dev/null | grep -q "$LABEL" && [ "${1:-}" != "--reload" ]; then
  echo "note: $LABEL is already loaded — leaving the running daemon untouched."
  echo "      to replace it (brief restart): bash scripts/install_launchd.sh --reload"
  exit 0
fi

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load -w "$PLIST"
sleep 1
if launchctl list | grep -q "$LABEL"; then echo "loaded $LABEL"; else echo "warning: $LABEL not loaded" >&2; fi
echo "health: curl -fsS http://127.0.0.1:${PORT}/health"
echo "logs:   $LOG_DIR/daemon.{out,err}.log"
