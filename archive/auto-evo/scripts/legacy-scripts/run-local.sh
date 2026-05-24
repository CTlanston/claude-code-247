#!/usr/bin/env bash
# Run orchestrator on the host (LOCAL_MODE), no Docker required.
# State + workspaces live in $HOME/.claude-247-state and /tmp/claude-247-workspaces.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "no .env — copy .env.example, set LOCAL_MODE=1 (already default in template)"
  exit 1
fi

# Source the env file so the values flow into Python via load_dotenv too.
set -a
. ./.env
set +a

export STATE_DIR="${STATE_DIR:-$HOME/.claude-247-state}"
export WORKSPACE_ROOT="${WORKSPACE_ROOT:-/tmp/claude-247-workspaces}"

mkdir -p "$STATE_DIR" "$WORKSPACE_ROOT"

cd orchestrator
exec python3 -u main.py
