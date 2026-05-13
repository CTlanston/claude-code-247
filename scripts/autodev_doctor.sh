#!/usr/bin/env bash
# autodev_doctor.sh — environment check.
#
# Exits 0 if all *required* checks pass, 1 if a required check fails. Optional
# checks (tmux, host claude) print warnings but don't fail the script.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PASS=0
FAIL=0
WARN=0

ok() { echo "  ✓ $1"; PASS=$((PASS+1)); }
warn() { echo "  ! $1"; WARN=$((WARN+1)); }
bad() { echo "  ✗ $1"; FAIL=$((FAIL+1)); }

echo "=== AutoDev doctor @ $(date -u +%FT%TZ) ==="
echo
echo "--- Required ---"
command -v python3 >/dev/null && ok "python3 ($(python3 --version 2>&1))" || bad "python3 missing"
command -v git >/dev/null && ok "git ($(git --version | head -1))" || bad "git missing"
command -v docker >/dev/null && ok "docker ($(docker --version 2>&1 | head -1))" || bad "docker missing"
command -v gh >/dev/null && ok "gh ($(gh --version | head -1))" || bad "gh missing"

# State directory
[[ -d reports ]] && ok "reports/ dir exists" || bad "reports/ dir missing"
[[ -d tasks ]] && ok "tasks/ dir exists" || bad "tasks/ dir missing"
[[ -d commands ]] && ok "commands/ dir exists" || bad "commands/ dir missing"

# Try a fast import of the autodev package
if python3 -c "import autodev, autodev.supervisor, autodev.project_state, autodev.report_manager, autodev.recovery_manager, autodev.backlog_manager, autodev.command_manager, autodev.cost_policy, autodev.executors.claude_code_cli, autodev.prompt_builder, autodev.inner_engine, autodev.sandbox_runner, autodev.ci_feedback" 2>err.log; then
  ok "autodev modules import cleanly"
  rm -f err.log
else
  bad "autodev module import failed (see err.log)"
  cat err.log 2>/dev/null | head -10
fi

# Runner image
if docker image inspect claude-code-247/runner:latest >/dev/null 2>&1; then
  ok "runner image present"
else
  warn "runner image not built — docker compose --profile build build runner"
fi

# state.json validity
if [[ -f reports/state.json ]]; then
  if python3 -c "import json; json.loads(open('reports/state.json').read())" 2>/dev/null; then
    ok "reports/state.json is valid JSON"
  else
    bad "reports/state.json is NOT valid JSON"
  fi
else
  warn "reports/state.json missing — will be created on first cycle"
fi

# HUMAN_CONFIG.md
if [[ -f HUMAN_CONFIG.md ]]; then
  ok "HUMAN_CONFIG.md present"
else
  warn "HUMAN_CONFIG.md missing (template at HUMAN_CONFIG.template.md) — cost defaults apply"
fi

# Cycle 22 — Track T6: live-sanity script
if [[ -x scripts/v5_live_sanity.sh ]]; then
  ok "v5_live_sanity.sh present + executable"
else
  warn "scripts/v5_live_sanity.sh missing or not executable (Track T6)"
fi

# Cycle 28 — Phase B: status dashboard
if [[ -x scripts/autodev_status_dashboard.sh ]]; then
  ok "autodev_status_dashboard.sh present + executable"
else
  warn "scripts/autodev_status_dashboard.sh missing or not executable (Phase B Cycle 28)"
fi

echo
echo "--- Optional ---"
command -v tmux >/dev/null && ok "tmux present" || warn "tmux not installed (Phase 14)"
command -v claude >/dev/null && ok "host claude CLI present" || warn "host claude not on PATH (Docker fallback will run)"

# Cost mode posture
if [[ -f reports/state.json ]]; then
  MODE=$(python3 -c "import json; print(json.load(open('reports/state.json')).get('cost_mode'))" 2>/dev/null || echo unknown)
  LIVE=$(python3 -c "import json; print(json.load(open('reports/state.json')).get('live_allowed'))" 2>/dev/null || echo unknown)
  echo "  cost_mode=$MODE  live_allowed=$LIVE"
fi

echo
echo "=== summary: $PASS passed, $FAIL failed, $WARN warned ==="
exit $((FAIL > 0))
