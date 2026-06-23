#!/usr/bin/env bash
# Install the independent Claude<->Codex autoflow loop as a launchd user agent.
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PNPM_BIN="${AEDEV_PNPM_BIN:-$(command -v pnpm || true)}"
NODE_BIN="$(command -v node || true)"
AUTOFLOW_HOME="${AEDEV_AUTOFLOW_HOME:-$HOME/.claude-code-247/autoflow}"
TARGET_REPO_ROOT="${AEDEV_AUTOFLOW_REPO_ROOT:-$REPO_ROOT}"
WORKBOOK="${AEDEV_AUTOFLOW_WORKBOOK:-$TARGET_REPO_ROOT/WORKBOOK_v4.md}"
AUTOFLOW_BRANCH="${AEDEV_AUTOFLOW_BRANCH:-codex/autoflow-workbook}"
START_INTERVAL="${AEDEV_AUTOFLOW_START_INTERVAL:-900}"
LOG_DIR="$AUTOFLOW_HOME/logs"
TPL="$REPO_ROOT/scripts/launchd/com.claude247.autoflow.plist.tpl"
LA_DIR="$HOME/Library/LaunchAgents"
LABEL="${AEDEV_AUTOFLOW_LABEL:-com.claude247.autoflow}"
PLIST="$LA_DIR/${LABEL}.plist"
MODE="${1:-}"

[ -n "$PNPM_BIN" ] || { echo "error: pnpm not found (set AEDEV_PNPM_BIN)" >&2; exit 1; }
[ -n "$NODE_BIN" ] || { echo "error: node not found on PATH" >&2; exit 1; }
[ -f "$TPL" ] || { echo "error: template missing: $TPL" >&2; exit 1; }
[ -f "$REPO_ROOT/scripts/autoflow-loop.ts" ] || { echo "error: scripts/autoflow-loop.ts missing" >&2; exit 1; }
[ -d "$REPO_ROOT/node_modules" ] || { echo "error: run 'pnpm install' first" >&2; exit 1; }
[[ "$LABEL" =~ ^[A-Za-z0-9_.-]+$ ]] || { echo "error: invalid AEDEV_AUTOFLOW_LABEL: $LABEL" >&2; exit 1; }
[[ "$START_INTERVAL" =~ ^[1-9][0-9]*$ ]] || { echo "error: invalid AEDEV_AUTOFLOW_START_INTERVAL: $START_INTERVAL" >&2; exit 1; }
if [ "$MODE" != "" ] && [ "$MODE" != "--reload" ] && [ "$MODE" != "--render-only" ]; then
  echo "error: unsupported mode: $MODE" >&2
  exit 1
fi

mkdir -p "$LOG_DIR" "$AUTOFLOW_HOME/evidence" "$LA_DIR"
PNPM_DIR="$(dirname "$PNPM_BIN")"
NODE_DIR="$(dirname "$NODE_BIN")"
NODE_REAL_DIR="$(dirname "$("$NODE_BIN" -p 'process.execPath' 2>/dev/null)")"
PATH_VAL="$PNPM_DIR:$NODE_DIR:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
[ -n "$NODE_REAL_DIR" ] && [ "$NODE_REAL_DIR" != "." ] && PATH_VAL="$NODE_REAL_DIR:$PATH_VAL"

xml_escape() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g' -e "s/'/\&apos;/g"
}

sed_escape() {
  printf '%s' "$1" | sed -e 's/[\/&]/\\&/g'
}

extra_env_entry() {
  local key="$1"
  local value="${!key-}"
  [ -n "$value" ] || return 0
  printf '    <key>%s</key><string>%s</string>\n' "$(xml_escape "$key")" "$(xml_escape "$value")"
}

EXTRA_ENV="$(
  for key in \
    AEDEV_AUTOFLOW_STATE \
    AEDEV_AUTOFLOW_LOG \
    AEDEV_AUTOFLOW_EVIDENCE_DIR \
    AEDEV_AUTOFLOW_WORKTREE \
    AEDEV_AUTOFLOW_START_INTERVAL \
    AEDEV_AUTOFLOW_REMOTE_MODE \
    AEDEV_AUTOFLOW_ALLOW_REMOTE_WRITES \
    AEDEV_AUTOFLOW_REMOTE_NAME \
    AEDEV_AUTOFLOW_PR_BASE \
    AEDEV_AUTOFLOW_ROTATE_REMOTE_BRANCHES \
    AEDEV_AUTOFLOW_HOLD_AFTER_FAILURES \
    AEDEV_AUTOFLOW_HOLD_AFTER_EMPTY_DIFFS \
    AEDEV_AUTOFLOW_COMMAND_TIMEOUT_MS \
    AEDEV_AUTOFLOW_WORKTREE_FETCH_TIMEOUT_MS \
    AEDEV_AUTOFLOW_SETUP_FETCH_ATTEMPTS \
    AEDEV_AUTOFLOW_RETAIN_CYCLE_WORKTREES \
    AEDEV_AUTOFLOW_RUNNING_STATE_TTL_MS \
    AEDEV_AUTOFLOW_STAGE_HEARTBEAT_MS \
    AEDEV_AUTOFLOW_CYCLE_SLEEP_MS \
    AEDEV_AUTOFLOW_SETUP_COMMANDS \
    AEDEV_AUTOFLOW_GATES \
    AEDEV_AUTOFLOW_FORBIDDEN \
    AEDEV_AUTOFLOW_CODER_PROVIDER \
    AEDEV_AUTOFLOW_CODER_RETRIES \
    AEDEV_AUTOFLOW_CLAUDE_MODEL \
    AEDEV_AUTOFLOW_CLAUDE_EFFORT \
    AEDEV_AUTOFLOW_CODEX_MODEL \
    AEDEV_AUTOFLOW_CODEX_CONFIG \
    AEDEV_GH_BIN \
    AEDEV_CLAUDE_BIN \
    AEDEV_CODEX_BIN \
    AEDEV_PNPM_BIN \
    CLAUDE_CODE_OAUTH_TOKEN_FILE \
    CODEX_HOME
  do
    extra_env_entry "$key"
  done
)"

TMP_PLIST="$(mktemp "${TMPDIR:-/tmp}/claude247-autoflow.XXXXXX")"
EXTRA_ENV_FILE="$(mktemp "${TMPDIR:-/tmp}/claude247-autoflow-env.XXXXXX")"
trap 'rm -f "$TMP_PLIST" "$EXTRA_ENV_FILE"' EXIT
printf '%s' "$EXTRA_ENV" > "$EXTRA_ENV_FILE"

sed -e "s#@@PNPM@@#$(sed_escape "$PNPM_BIN")#g" \
    -e "s#@@REPO_ROOT@@#$(sed_escape "$REPO_ROOT")#g" \
    -e "s#@@TARGET_REPO_ROOT@@#$(sed_escape "$TARGET_REPO_ROOT")#g" \
    -e "s#@@WORKBOOK@@#$(sed_escape "$WORKBOOK")#g" \
    -e "s#@@LOG_DIR@@#$(sed_escape "$LOG_DIR")#g" \
    -e "s#@@HOME@@#$(sed_escape "$HOME")#g" \
    -e "s#@@PATH@@#$(sed_escape "$PATH_VAL")#g" \
    -e "s#@@LABEL@@#$(sed_escape "$LABEL")#g" \
    -e "s#@@AUTOFLOW_BRANCH@@#$(sed_escape "$AUTOFLOW_BRANCH")#g" \
    -e "s#@@START_INTERVAL@@#$(sed_escape "$START_INTERVAL")#g" \
    -e "s#@@AUTOFLOW_HOME@@#$(sed_escape "$AUTOFLOW_HOME")#g" \
    "$TPL" > "$TMP_PLIST"
awk -v extra_file="$EXTRA_ENV_FILE" '
  /@@EXTRA_ENV@@/ {
    while ((getline line < extra_file) > 0) print line
    close(extra_file)
    next
  }
  { print }
' "$TMP_PLIST" > "$PLIST"

if command -v plutil >/dev/null 2>&1; then
  plutil -lint "$PLIST" >/dev/null || { echo "error: rendered plist failed plutil -lint" >&2; exit 1; }
fi
echo "rendered + validated $PLIST"

if [ "$MODE" = "--render-only" ]; then
  echo "render-only: launchctl not changed"
  exit 0
fi

if launchctl list 2>/dev/null | grep -q "$LABEL" && [ "$MODE" != "--reload" ]; then
  echo "note: $LABEL is already loaded - leaving it untouched."
  echo "      to replace it: AEDEV_AUTOFLOW_LABEL=$LABEL bash scripts/install_autoflow_launchd.sh --reload"
  exit 0
fi

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load -w "$PLIST"
sleep 1
if launchctl list | grep -q "$LABEL"; then echo "loaded $LABEL"; else echo "warning: $LABEL not loaded" >&2; fi
echo "state: ${AEDEV_AUTOFLOW_STATE:-$AUTOFLOW_HOME/state.json}"
echo "logs:  $LOG_DIR/autoflow.{out,err}.log and ${AEDEV_AUTOFLOW_LOG:-$LOG_DIR/autoflow.jsonl}"
