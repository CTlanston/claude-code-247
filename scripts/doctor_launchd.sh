#!/usr/bin/env bash
# launchd-specific doctor. Reports which com.claude247.* services are
# loaded, running, reachable, and the last error lines from their logs.
#
# Output is human-readable (one block per service). Exit 0 always
# (this is informational, not a gate).
set -Eeuo pipefail

SERVICES=(
  com.claude247.dashboard
  com.claude247.orchestrator
  com.claude247.dispatcher
  com.claude247.backup
)

LOG_DIR="$HOME/.claude-code-247/logs"
DASHBOARD_HOST="${CLAUDE247_DASHBOARD_HOST:-127.0.0.1}"
DASHBOARD_PORT="${CLAUDE247_DASHBOARD_PORT:-8423}"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m•\033[0m %s\n' "$*"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$*"; }

# launchctl list <name> exits 0 if loaded, 113 if not.
loaded() {
  launchctl list "$1" >/dev/null 2>&1
}

# Pull the PID line from launchctl print, if loaded.
pid_of() {
  launchctl list 2>/dev/null | awk -v name="$1" '$3==name {print $1}' | head -1
}

# Last 5 lines of a service's stderr log, if present.
tail_err() {
  local f="$LOG_DIR/$1"
  if [[ -f "$f" ]]; then
    printf '    last 5 err lines: %s\n' "$f"
    sed -n '$-4,$p' "$f" 2>/dev/null | sed 's/^/      | /'
  fi
}

bold "claude247 launchd doctor"
echo "  log dir: $LOG_DIR"

for svc in "${SERVICES[@]}"; do
  echo
  bold "  $svc"
  if loaded "$svc"; then
    pid=$(pid_of "$svc")
    if [[ -n "$pid" && "$pid" != "-" ]]; then
      ok "loaded (pid $pid running)"
    else
      warn "loaded (no PID — between fires or last run failed)"
    fi
  else
    fail "NOT loaded — run scripts/install_launchd.sh"
  fi
  short="${svc#com.claude247.}"
  err_log="$LOG_DIR/${short}.err.log"
  out_log="$LOG_DIR/${short}.out.log"
  if [[ -f "$err_log" ]]; then
    sz=$(wc -c < "$err_log" | tr -d ' ')
    if [[ "$sz" -gt 0 ]]; then
      warn "$err_log ($sz bytes)"
      tail_err "${short}.err.log"
    else
      ok "$err_log (empty)"
    fi
  fi
  if [[ -f "$out_log" ]]; then
    ok "$out_log present"
  fi
done

echo
bold "  dashboard reachability"
if curl -fsS -m 2 "http://${DASHBOARD_HOST}:${DASHBOARD_PORT}/healthz" >/dev/null 2>&1; then
  ok "http://${DASHBOARD_HOST}:${DASHBOARD_PORT}/healthz OK"
else
  warn "http://${DASHBOARD_HOST}:${DASHBOARD_PORT}/healthz unreachable"
fi

echo
echo "(informational; see also: claude247 doctor --json)"
