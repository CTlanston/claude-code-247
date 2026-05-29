#!/usr/bin/env bash
# Environment doctor for the TypeScript aedev daemon (port 7247).
# Required checks (node/pnpm/deps) hard-fail; runtime checks (daemon up,
# launchd job, worker CLI) are informational warnings.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${AEDEV_DAEMON_PORT:-7247}"
AEDEV_HOME="${AEDEV_HOME:-$HOME/.claude-code-247}"
fail=0
ok()   { printf "  ok    %s\n" "$1"; }
warn() { printf "  warn  %s\n" "$1"; }
bad()  { printf "  FAIL  %s\n" "$1"; fail=1; }

echo "aedev doctor"

if command -v node >/dev/null 2>&1; then
  v="$(node -v)"; major="${v#v}"; major="${major%%.*}"
  if [ "${major:-0}" -ge 20 ] 2>/dev/null; then ok "node $v"; else bad "node $v (need >= 20)"; fi
else
  bad "node not found"
fi

if command -v pnpm >/dev/null 2>&1; then ok "pnpm $(pnpm -v)"; else bad "pnpm not found (npm i -g pnpm)"; fi
if [ -d "$REPO_ROOT/node_modules" ]; then ok "dependencies installed"; else bad "run 'pnpm install'"; fi

if [ -d "$AEDEV_HOME" ]; then ok "AEDEV_HOME $AEDEV_HOME"; else warn "AEDEV_HOME missing ($AEDEV_HOME) — created on install"; fi
if launchctl list 2>/dev/null | grep -q com.claude247.daemon; then ok "launchd daemon job loaded"; else warn "daemon not installed (run scripts/install_launchd.sh)"; fi
if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then ok "daemon health green on :${PORT}"; else warn "daemon not responding on :${PORT}"; fi
if command -v claude >/dev/null 2>&1; then ok "claude CLI present (worker path)"; else warn "claude CLI not found"; fi
if command -v codex >/dev/null 2>&1; then ok "codex CLI present (worker fallback)"; else warn "codex CLI not found"; fi

echo
if [ "$fail" -eq 0 ]; then echo "doctor: required checks passed"; exit 0; else echo "doctor: required checks FAILED"; exit 1; fi
