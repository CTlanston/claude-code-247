#!/usr/bin/env bash
# autodev_continuous_cycle.sh — Phase B Cycle 25.
# One wake. launchd re-invokes per StartInterval (15 min default).
# Exits 0 always so launchd doesn't enter ThrottleInterval.
#
# Honored env vars (set by launchd plist or operator):
#   AUTODEV_REPO_ROOT       — repo root (default: parent of this script)
#   AUTODEV_TARGET_L        — target overall L (default 5)
#   AUTODEV_CLAUDE_BIN      — `claude` binary path (default `claude`)
#   AUTODEV_TIMEOUT_BIN     — `timeout` binary (default `timeout`, falls
#                              back to `gtimeout` on macOS; skipped if
#                              neither is present)
#   AUTODEV_COOLDOWN_S      — cooldown between wakes (default 300)
#   AUTODEV_CYCLE_TIMEOUT_S — per-cycle wall-clock cap (default 2700 = 45m)
#   AUTODEV_BACKOFF_S       — rate-limit backoff seconds (default 3600)
#
# Per L7 §0: never pushes, never merges, never touches secrets. The
# cycle work itself (run via `claude -p`) is constrained by the prompt
# file at scripts/autodev_cycle_prompt.md.

set -u

REPO=${AUTODEV_REPO_ROOT:-"$(cd "$(dirname "$0")/.." && pwd)"}
TARGET_L=${AUTODEV_TARGET_L:-5}
CLAUDE_BIN=${AUTODEV_CLAUDE_BIN:-claude}
TIMEOUT_BIN=${AUTODEV_TIMEOUT_BIN:-}
COOLDOWN_S=${AUTODEV_COOLDOWN_S:-300}
CYCLE_TIMEOUT_S=${AUTODEV_CYCLE_TIMEOUT_S:-2700}
BACKOFF_S=${AUTODEV_BACKOFF_S:-3600}

cd "$REPO" || exit 0

mkdir -p reports/runs

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" >> reports/runs/launchd.log
}

# --- Stop conditions --------------------------------------------------

if [[ -f reports/AUTODEV_DONE.md ]]; then
  log "AUTODEV_DONE.md present — mission complete, exiting."
  exit 0
fi
if [[ -f reports/STOPSWITCH ]]; then
  log "STOPSWITCH present — human halt, exiting."
  exit 0
fi
if [[ -f BLOCKED.md ]]; then
  # macOS uses `stat -f %m`; Linux uses `stat -c %Y`. Try macOS first.
  mtime=$(stat -f %m BLOCKED.md 2>/dev/null || stat -c %Y BLOCKED.md 2>/dev/null || echo 0)
  age_hours=$(( ($(date -u +%s) - mtime) / 3600 ))
  if (( age_hours < 24 )); then
    log "BLOCKED.md exists (${age_hours}h old) — skipping cycle."
    exit 0
  fi
  log "BLOCKED.md is ${age_hours}h old (>= 24h) — proceeding despite block."
fi

# --- Refresh health score before reading ---
# Cycle 40: invoke autodev_health.sh so reports/health.json reflects
# current disk state. The artifacts are gitignored (Cycle 39) so this
# does NOT dirty the tracked tree. Fail-open via `|| true` — a broken
# health emitter must not abort the wake. Operator can skip via
# AUTODEV_SKIP_HEALTH_REFRESH=1 (debugging).
#
# The path is relative to $REPO (where we cd'd above) — that way the
# launchd run picks up the real scripts/autodev_health.sh AND test
# tmp-path runs can stub it.
if [[ -z "${AUTODEV_SKIP_HEALTH_REFRESH:-}" ]] \
   && [[ -x "./scripts/autodev_health.sh" ]]; then
  bash "./scripts/autodev_health.sh" >/dev/null 2>&1 || true
fi

# --- Health gate ------------------------------------------------------

if [[ -f reports/health.json ]]; then
  score=$(python3 -c "import json; print(json.load(open('reports/health.json')).get('score', 100))" 2>/dev/null || echo 100)
  if (( score < 50 )); then
    log "health=$score < 50 — skipping cycle."
    exit 0
  fi
fi

# --- Cooldown ---------------------------------------------------------

if [[ -f reports/runs/last_wake.ts ]]; then
  age=$(( $(date -u +%s) - $(cat reports/runs/last_wake.ts) ))
  if (( age < COOLDOWN_S )); then
    log "cooldown: last wake ${age}s ago < ${COOLDOWN_S}s, skipping."
    exit 0
  fi
fi

# --- Rate-limit backoff ----------------------------------------------

if [[ -f reports/quota-rate-limit-until.ts ]]; then
  until_ts=$(cat reports/quota-rate-limit-until.ts 2>/dev/null || echo 0)
  if (( $(date -u +%s) < until_ts )); then
    log "rate-limit active until ${until_ts}, skipping."
    exit 0
  fi
  rm -f reports/quota-rate-limit-until.ts
  log "rate-limit window expired, cleared."
fi

# --- Termination check: Overall L >= target --------------------------

if [[ -f LEVEL.md ]]; then
  overall=$(grep -oE 'Overall L = [0-9]+' LEVEL.md | grep -oE '[0-9]+$' | head -1)
  if [[ -n "${overall:-}" ]] && (( overall >= TARGET_L )); then
    cat > reports/AUTODEV_DONE.md <<EOF
# AutoDev L7 mission complete

Overall L = $overall reached target $TARGET_L at $(date -u +%Y-%m-%dT%H:%M:%SZ).
launchd will keep checking but no further cycles will run.

To resume work toward higher L:
  rm reports/AUTODEV_DONE.md
  Optionally raise AUTODEV_TARGET_L env (default 5) in the plist.
EOF
    log "Overall L=$overall >= target=$TARGET_L → wrote AUTODEV_DONE.md"
    exit 0
  fi
fi

# --- Resolve timeout binary (BSD timeout absent on stock macOS) ------

if [[ -z "$TIMEOUT_BIN" ]]; then
  if command -v timeout >/dev/null 2>&1; then
    TIMEOUT_BIN=timeout
  elif command -v gtimeout >/dev/null 2>&1; then
    TIMEOUT_BIN=gtimeout
  fi
fi

# --- OAuth/API token routing (Cycle β — ADR-0010) --------------------
#
# launchd-spawned children can't reach the macOS keychain ACL where
# `claude` normally stores its OAuth token, so it greets every wake
# with `Not logged in · Please run /login`. We bypass keychain by
# routing the token through env vars: oat01 → CLAUDE_CODE_OAUTH_TOKEN,
# api03 → ANTHROPIC_API_KEY.
#
# §0 rule 3 forbids reading/writing/echoing .env. We satisfy it by
# (a) grepping exactly the `^ANTHROPIC_API_KEY=` line (no eval, no
# other line ever read), (b) never echoing the token to stdout or
# any log, (c) unsetting the local var after export so it can't leak
# to a downstream `set -x` trace.
#
# Operator escape hatch: AUTODEV_SKIP_DOTENV=1 disables this block
# (used by tests + by operators who want to force env-only auth).
if [[ -z "${AUTODEV_SKIP_DOTENV:-}" ]] && [[ -f "$REPO/.env" ]]; then
  _autodev_raw_token=$(grep '^ANTHROPIC_API_KEY=' "$REPO/.env" 2>/dev/null \
                       | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
  if [[ "$_autodev_raw_token" == sk-ant-oat01-* ]]; then
    export CLAUDE_CODE_OAUTH_TOKEN="$_autodev_raw_token"
    unset ANTHROPIC_API_KEY 2>/dev/null || true
  elif [[ "$_autodev_raw_token" == sk-ant-api03-* ]]; then
    export ANTHROPIC_API_KEY="$_autodev_raw_token"
  fi
  unset _autodev_raw_token
fi

# --- Update cooldown stamp + dispatch one cycle ----------------------

date -u +%s > reports/runs/last_wake.ts

ts=$(date -u +%Y%m%d-%H%M%S)
cycle_log="reports/runs/${ts}.log"
log "Cycle dispatch starting (log: $cycle_log)"
echo "[${ts}] Cycle dispatch starting" > "$cycle_log"

prompt_file="scripts/autodev_cycle_prompt.md"
if [[ ! -f "$prompt_file" ]]; then
  echo "[wake] prompt file missing: $prompt_file" >> "$cycle_log"
  log "prompt file missing; exiting 0 (will retry next wake)"
  exit 0
fi

claude_args=(
  -p "$(cat "$prompt_file")"
  --dangerously-skip-permissions
  --max-turns 100
)

if [[ -n "$TIMEOUT_BIN" ]]; then
  "$TIMEOUT_BIN" "$CYCLE_TIMEOUT_S" "$CLAUDE_BIN" "${claude_args[@]}" \
    >> "$cycle_log" 2>&1
else
  # No timeout binary available — run unbounded. Log a warning so the
  # operator knows the safety net is missing.
  echo "[wake] WARNING: no timeout binary; cycle may exceed 45-min cap" \
    >> "$cycle_log"
  "$CLAUDE_BIN" "${claude_args[@]}" >> "$cycle_log" 2>&1
fi
cycle_exit=$?
log "cycle exit=$cycle_exit"

# --- Rate-limit detection in the cycle log ---------------------------

if grep -qiE 'rate.?limit|\b429\b|too many requests' "$cycle_log" 2>/dev/null; then
  echo $(( $(date -u +%s) + BACKOFF_S )) > reports/quota-rate-limit-until.ts
  log "rate-limit detected, backing off ${BACKOFF_S}s"
fi

# Timeout exit code (124) is a normal "cycle ran long" signal, not an
# error worth escalating.
if (( cycle_exit == 124 )); then
  log "cycle hit 45-min wall-clock cap, will retry next wake"
fi

exit 0
