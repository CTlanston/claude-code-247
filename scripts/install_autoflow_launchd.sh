#!/usr/bin/env bash
# Install the independent Claude<->Codex autoflow loop as a launchd user agent.
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PNPM_BIN="${AEDEV_PNPM_BIN:-$(command -v pnpm || true)}"
NODE_BIN="$(command -v node || true)"
AUTOFLOW_HOME="${AEDEV_AUTOFLOW_HOME:-$HOME/.claude-code-247/autoflow}"
LOG_DIR="$AUTOFLOW_HOME/logs"
TPL="$REPO_ROOT/scripts/launchd/com.claude247.autoflow.plist.tpl"
LA_DIR="$HOME/Library/LaunchAgents"
PLIST="$LA_DIR/com.claude247.autoflow.plist"
LABEL="com.claude247.autoflow"

[ -n "$PNPM_BIN" ] || { echo "error: pnpm not found (set AEDEV_PNPM_BIN)" >&2; exit 1; }
[ -n "$NODE_BIN" ] || { echo "error: node not found on PATH" >&2; exit 1; }
[ -f "$TPL" ] || { echo "error: template missing: $TPL" >&2; exit 1; }
[ -f "$REPO_ROOT/scripts/autoflow-loop.ts" ] || { echo "error: scripts/autoflow-loop.ts missing" >&2; exit 1; }
[ -d "$REPO_ROOT/node_modules" ] || { echo "error: run 'pnpm install' first" >&2; exit 1; }

mkdir -p "$LOG_DIR" "$AUTOFLOW_HOME/evidence" "$LA_DIR"
PNPM_DIR="$(dirname "$PNPM_BIN")"
NODE_DIR="$(dirname "$NODE_BIN")"
NODE_REAL_DIR="$(dirname "$("$NODE_BIN" -p 'process.execPath' 2>/dev/null)")"
PATH_VAL="$PNPM_DIR:$NODE_DIR:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
[ -n "$NODE_REAL_DIR" ] && [ "$NODE_REAL_DIR" != "." ] && PATH_VAL="$NODE_REAL_DIR:$PATH_VAL"

sed -e "s#@@PNPM@@#${PNPM_BIN}#g" \
    -e "s#@@REPO_ROOT@@#${REPO_ROOT}#g" \
    -e "s#@@LOG_DIR@@#${LOG_DIR}#g" \
    -e "s#@@HOME@@#${HOME}#g" \
    -e "s#@@PATH@@#${PATH_VAL}#g" \
    -e "s#@@AUTOFLOW_HOME@@#${AUTOFLOW_HOME}#g" \
    "$TPL" > "$PLIST"

if command -v plutil >/dev/null 2>&1; then
  plutil -lint "$PLIST" >/dev/null || { echo "error: rendered plist failed plutil -lint" >&2; exit 1; }
fi
echo "rendered + validated $PLIST"

if launchctl list 2>/dev/null | grep -q "$LABEL" && [ "${1:-}" != "--reload" ]; then
  echo "note: $LABEL is already loaded - leaving it untouched."
  echo "      to replace it: bash scripts/install_autoflow_launchd.sh --reload"
  exit 0
fi

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load -w "$PLIST"
sleep 1
if launchctl list | grep -q "$LABEL"; then echo "loaded $LABEL"; else echo "warning: $LABEL not loaded" >&2; fi
echo "state: $AUTOFLOW_HOME/state.json"
echo "logs:  $LOG_DIR/autoflow.{out,err}.log and $LOG_DIR/autoflow.jsonl"
