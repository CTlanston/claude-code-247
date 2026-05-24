#!/usr/bin/env bash
# start_remote_control.sh — start Claude Code Remote Control in this repo.
#
# Requires the Claude Code Remote Control feature (web/phone access to the
# local Claude Code session). Best-effort; falls back to printing manual
# instructions if the necessary binary/CLI command isn't available.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Claude Code Remote Control launcher ==="
echo "Working dir: $ROOT"
echo

if command -v claude >/dev/null 2>&1; then
  # Claude Code 2.1+ exposes `claude remote` (subject to version drift).
  if claude remote --help >/dev/null 2>&1; then
    cd "$ROOT"
    exec claude remote --start
  fi
  echo "[start_remote_control] 'claude remote' subcommand not available in this CLI version." >&2
fi

cat <<'INFO'
Manual setup (until host Claude Code CLI is installed):

  1. Install Claude Code on host:        npm install -g @anthropic-ai/claude-code
  2. Login to subscription:              claude /login
  3. Optional long-lived token:          claude setup-token
  4. Enable Remote Control:              claude /remote enable

Once Remote Control is enabled you can:
  - View status from your phone/browser
  - Add commands to `commands/inbox.md` (the supervisor processes them on
    its next cycle, every $AUTODEV_INTERVAL_SECONDS seconds)
  - Trigger /pause, /resume, /status, /report via the web UI

When Remote Control is unavailable, you can still drive the supervisor by
appending lines to `commands/inbox.md` over SSH or via a synced folder.
INFO
exit 2
