#!/usr/bin/env bash
# start_tmux_autodev.sh — create or attach to a tmux session running the supervisor.
#
# Usage:
#   ./scripts/start_tmux_autodev.sh             # detached if new, attach if existing
#   ./scripts/start_tmux_autodev.sh --attach    # always attach (foreground)
#
# If tmux isn't installed, falls back to printing the equivalent nohup command.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SESSION="${AUTODEV_TMUX_SESSION:-autodev}"
SUPER="$ROOT/scripts/autodev_supervisor.sh"

if ! command -v tmux >/dev/null 2>&1; then
  echo "[start_tmux_autodev] tmux not installed. Equivalent without tmux:" >&2
  echo "  nohup bash '$SUPER' > '$ROOT/reports/supervisor.stdout.log' 2> '$ROOT/reports/supervisor.stderr.log' &" >&2
  exit 2
fi

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "[start_tmux_autodev] session '$SESSION' already running"
  if [[ "${1:-}" == "--attach" ]]; then
    exec tmux attach -t "$SESSION"
  fi
  exit 0
fi

echo "[start_tmux_autodev] creating new session '$SESSION'"
tmux new-session -d -s "$SESSION" -c "$ROOT" \
  "bash '$SUPER' 2>&1 | tee -a '$ROOT/reports/supervisor.log'"

if [[ "${1:-}" == "--attach" ]]; then
  exec tmux attach -t "$SESSION"
fi
echo "[start_tmux_autodev] supervisor running detached in tmux session '$SESSION'"
echo "[start_tmux_autodev] attach with: tmux attach -t $SESSION"
