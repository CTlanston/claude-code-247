#!/usr/bin/env bash
# Wrapper for `claude247 doctor` that locates the venv binary.
set -Eeuo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="${CLAUDE247_BIN:-$REPO_ROOT/.venv/bin/claude247}"
exec "$BIN" doctor "$@"
