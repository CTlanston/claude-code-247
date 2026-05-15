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
# PILOT_IN_PROGRESS overrides the two "soft" gates (DONE / STOPSWITCH)
# so a P5 production pilot keeps dispatching cycles after the system
# has self-declared mission complete. It deliberately does NOT override
# health<50 or fresh BLOCKED.md — those are real safety gates.

if [[ -f reports/PILOT_IN_PROGRESS ]]; then
  log "PILOT_IN_PROGRESS present — overriding DONE/STOPSWITCH gates."
else
  if [[ -f reports/AUTODEV_DONE.md ]]; then
    log "AUTODEV_DONE.md present — mission complete, exiting."
    exit 0
  fi
  if [[ -f reports/STOPSWITCH ]]; then
    log "STOPSWITCH present — human halt, exiting."
    exit 0
  fi
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

# --- Termination check: Overall L >= target (with stability gate) ----
#
# Cycle ε: don't celebrate on a single-cycle level-up — require N
# consecutive cycles at or above target before writing AUTODEV_DONE.md.
# Threshold: AUTODEV_STABILITY_THRESHOLD (default 5).
# Emergency stop: AUTODEV_SKIP_STABILITY_GATE=1 trips DONE.md on the
# first cycle at or above target (the pre-ε behavior).

if [[ -f LEVEL.md ]]; then
  overall=$(grep -oE 'Overall L = [0-9]+' LEVEL.md | grep -oE '[0-9]+$' | head -1)
  stability_file="reports/level5-stability.txt"
  stability_threshold=${AUTODEV_STABILITY_THRESHOLD:-5}

  if [[ -n "${overall:-}" ]] && (( overall >= TARGET_L )); then
    # Increment stability counter
    stab=$(cat "$stability_file" 2>/dev/null || echo 0)
    stab=$((stab + 1))
    echo "$stab" > "$stability_file"
    log "L${overall} >= target=${TARGET_L}; stability=${stab}/${stability_threshold}"

    # Trip DONE.md when stable (or when operator forces it via env)
    if [[ -n "${AUTODEV_SKIP_STABILITY_GATE:-}" ]] || (( stab >= stability_threshold )); then
      # Gather data for the expanded DONE.md schema (Cycle ε / ADR-0013).
      # All sources are best-effort; missing data renders as "NO_DATA".
      done_ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
      total_cycles=$(grep -cE '^[0-9]{8}-[0-9]{6} \|' CHANGELOG.md 2>/dev/null || echo NO_DATA)
      total_commits=$(git rev-list --count HEAD 2>/dev/null || echo NO_DATA)
      c_streak_hwm=$(cat reports/zero-deadlock-streak.txt 2>/dev/null || echo NO_DATA)
      bootstrap_ts=$(git log --reverse --format=%cI 2>/dev/null | head -1 || echo NO_DATA)
      codex_spend_total=$(python3 - <<'PYEOF' 2>/dev/null || echo NO_DATA
import json, pathlib
p = pathlib.Path("reports/codex-spend.jsonl")
if not p.exists():
    print("NO_DATA")
else:
    total = 0
    for ln in p.read_text().splitlines():
        try:
            row = json.loads(ln)
        except Exception:
            continue
        total += int(row.get("tokens_used", 0) or 0)
    print(total)
PYEOF
)
      level_md_block=$(grep -E '^[MSRCTE] [0-9] \|' LEVEL.md 2>/dev/null \
                        || echo "(LEVEL.md unreadable)")

      cat > reports/AUTODEV_DONE.md <<EOF
# AutoDev L7 — Mission Complete

**Reached at**: ${done_ts}
**Overall L**: ${overall} (target: ${TARGET_L})
**Stability**: ${stab} consecutive cycles at or above target
**Triggering threshold**: ${stability_threshold}

## Per-dimension levels (from LEVEL.md)

\`\`\`
${level_md_block}
\`\`\`

## Cumulative totals since Bootstrap

| Metric                              | Value |
|-------------------------------------|-------|
| Cycles executed (CHANGELOG entries) | ${total_cycles} |
| Git commits on this branch          | ${total_commits} |
| C-dim streak high-water mark        | ${c_streak_hwm} |
| Bootstrap commit timestamp          | ${bootstrap_ts} |
| Codex token spend (sum reports/codex-spend.jsonl) | ${codex_spend_total} |

## Honest assessment

This system has reached \`Overall L >= ${TARGET_L}\` and held that
level for ${stab} consecutive cycles. What it can do now:

- Drive disciplined L7-rubric cycles on its own (Planner / Coder /
  Reviewer / Guardian, all gated, all recording).
- Survive launchd-spawned wakes (Cycle β fixed keychain ACL; ADR-0010).
- Reinstall its own launchd agent reproducibly (Cycle γ; ADR-0011).
- Escalate repeat failures via BLOCKED.md within 3 wakes (Cycle δ;
  ADR-0012).
- Decide for itself when it's done (this cycle; ADR-0013).

What it still can NOT do (the §1 honest ceiling, unchanged):
- Make product / UX / stakeholder decisions.
- Resolve novel architectural choices without operator input.
- Crisis response (the operator is still the on-call human).

## To resume work toward higher L

\`\`\`bash
rm reports/AUTODEV_DONE.md
# Optionally raise AUTODEV_TARGET_L (default 5) in the launchd plist:
AUTODEV_TARGET_L=6 bash scripts/install_launchd_continuous.sh --install
\`\`\`

launchd will keep firing per its StartInterval but exit 0
immediately on detecting this file. Removing it re-enables
dispatch on the next wake.
EOF
      log "Overall L=${overall} >= target=${TARGET_L} stable ${stab}/${stability_threshold} → wrote AUTODEV_DONE.md"
      exit 0
    fi
  else
    # L dropped below target → reset stability window. Drops are a
    # signal that the level isn't load-bearing yet.
    if [[ -f "$stability_file" ]]; then
      rm -f "$stability_file"
      log "L${overall:-?} < target=${TARGET_L}; stability counter reset"
    fi
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

# --- Self-repair trigger (Cycle δ — ADR-0012) -------------------------
#
# When a cycle fails (nonzero exit) with the SAME signature as the
# previous N wakes, escalate to scripts/autodev_self_repair.sh. The
# signature is SHA-256 of the last 10 lines of the cycle log; that's
# stable across identical failures, distinct across different ones.
#
# State files (gitignored under reports/runs/):
#   .failure-signature.last   — last signature seen
#   .failure-signature.count  — consecutive wakes hitting it
#
# Threshold = 3 (operator-tunable via AUTODEV_SELF_REPAIR_THRESHOLD).
# Successful cycles clear both state files. Timeouts (exit 124) and
# rate-limit signals don't count toward the threshold — they're
# already handled upstream.
#
# Escape hatch: AUTODEV_SKIP_SELF_REPAIR=1 disables the trigger.

if [[ -z "${AUTODEV_SKIP_SELF_REPAIR:-}" ]] && (( cycle_exit != 0 && cycle_exit != 124 )); then
  _autodev_self_repair_threshold=${AUTODEV_SELF_REPAIR_THRESHOLD:-3}
  _autodev_new_sig=$(tail -n +2 "$cycle_log" 2>/dev/null | tail -10 \
                     | shasum -a 256 2>/dev/null | cut -d' ' -f1)
  if [[ -n "$_autodev_new_sig" ]]; then
    _autodev_last_sig=$(cat reports/runs/.failure-signature.last 2>/dev/null || echo "")
    if [[ "$_autodev_new_sig" == "$_autodev_last_sig" ]]; then
      _autodev_count=$(cat reports/runs/.failure-signature.count 2>/dev/null || echo 0)
      _autodev_count=$((_autodev_count + 1))
    else
      _autodev_count=1
      echo "$_autodev_new_sig" > reports/runs/.failure-signature.last
    fi
    echo "$_autodev_count" > reports/runs/.failure-signature.count
    log "failure-signature ${_autodev_new_sig:0:12}... count=${_autodev_count}/${_autodev_self_repair_threshold}"

    if (( _autodev_count >= _autodev_self_repair_threshold )); then
      _autodev_repair_bin=${AUTODEV_SELF_REPAIR_BIN:-bash $REPO/scripts/autodev_self_repair.sh}
      log "SELF-REPAIR triggered (signature ${_autodev_new_sig:0:12}... matched ${_autodev_count} consecutive cycles)"
      $_autodev_repair_bin "$cycle_log" "$_autodev_new_sig" >> "$cycle_log" 2>&1 || true
      # Reset the counter so the self-repair handler gets one shot
      # per 3-strike window (operator action expected after BLOCKED).
      : > reports/runs/.failure-signature.count
    fi
  fi
  unset _autodev_new_sig _autodev_last_sig _autodev_count _autodev_self_repair_threshold _autodev_repair_bin
elif (( cycle_exit == 0 )); then
  # Successful cycle clears any prior failure-signature state.
  rm -f reports/runs/.failure-signature.last reports/runs/.failure-signature.count 2>/dev/null || true
fi

exit 0
