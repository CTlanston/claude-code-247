# AutoDev L7 — Continuous Run Master Prompt

> The mission of THIS session is twofold:
>   (1) Push T → 7, E → 7 via single-cycle work (Phase A, ~3 cycles)
>   (2) Build the launchd-based 7×24 autonomous run infrastructure (Phase B)
>   (3) Hand off to launchd-driven indefinite operation (Phase C)
>   (4) Within whatever session time remains, keep doing cycles until natural session end (Phase D)
>
> Read AUTODEV_L7_MASTER_PROMPT.md and reports/L7-session-wakeup-summary.md first.
> Current state: Overall L=4. M=S=R=7 maxed. T=5, E=6, C=4. C streak=2/30.

---

## Phase A — Single-cycle level-ups (cheapest first)

Execute in order. Each is one §4 cycle.

### Cycle 22 — Track T6 (live sanity script)
- Build `scripts/v5_live_sanity.sh` per L7 §3 Dim T rubric (live sanity loop per RC concept)
- Read `AUTODEV_LIVE` env var (default 0)
- `AUTODEV_LIVE=0` (default): simulate one full pipeline tick, write `reports/live-sanity/<ts>.json` with stage transitions, exit 0
- `AUTODEV_LIVE=1`: refuse with exit 2 unless `HUMAN_CONFIG.runtime.live_sanity_authorized: true` (which stays false)
- Wire into `autodev_doctor.sh` as a check
- Regression tests: dry-run success, live-mode refusal, JSON schema validity
- Acceptance: T → L6

### Cycle 23 — Track T7 (golden-diff fixtures)
- Build `tests/golden/` directory with captured stdout/stderr/state-mutation patterns for known-good e2e cycles
- Add `tests/test_golden_diff.py` with character-level diff vs fixtures
- On mismatch: write diff to `cycles/<id>/golden-diff.md`, fail the test (do NOT auto-update)
- Build `scripts/update_goldens.sh` — the only way to refresh fixtures, with operator confirmation prompt
- Acceptance: T → L7 (T at max)

### Cycle 24 — Track E7 (verify autonomy of promotions)
- Read CHANGELOG.md for 🎯 entries (M-L7, S-L7, R-L7 — the 3 most recent promotions)
- For each, check the corresponding `cycles/<id>/PLAN.md` for `proposed_by: propose_next_track` field
- If all 3 cite propose_next_track → compute_level picks up E=7 automatically
- If any missing the field, add retroactive citation in the PLAN's frontmatter (the proposal *was* made; the evidence cite was missing)
- Acceptance: E → L7

After Phase A: M=S=R=T=E=7. Only C remains at 4. Overall stays 4 (C is sole gate). The path to Overall 5 is now ONLY the 30-cycle C streak.

---

## Phase B — Build the 7×24 autonomous infrastructure

### Cycle 25 — Build `scripts/autodev_continuous_cycle.sh`

The wake script that launchd will invoke every 15 minutes. Must:

```bash
#!/usr/bin/env bash
# autodev_continuous_cycle.sh — one wake. launchd re-invokes per StartInterval.
# Exits cleanly even on failure so launchd can keep firing.

set -u
cd "$(dirname "$0")/.." || exit 0   # repo root

# Stop condition checks (any one halts cycle dispatch)
if [[ -f reports/AUTODEV_DONE.md ]]; then
  echo "[$(date -u)] AUTODEV_DONE.md present — mission complete, exiting." \
    >> reports/runs/launchd.log
  exit 0
fi
if [[ -f reports/STOPSWITCH ]]; then
  echo "[$(date -u)] STOPSWITCH present — human halt, exiting." >> reports/runs/launchd.log
  exit 0
fi
if [[ -f BLOCKED.md ]]; then
  # only escalate after 24h
  age_hours=$(( ($(date -u +%s) - $(stat -f %m BLOCKED.md)) / 3600 ))
  if (( age_hours < 24 )); then
    echo "[$(date -u)] BLOCKED.md exists (${age_hours}h old) — skipping cycle." >> reports/runs/launchd.log
    exit 0
  fi
fi

# Health gate
if [[ -f reports/health.json ]]; then
  score=$(python3 -c "import json; print(json.load(open('reports/health.json')).get('score', 100))")
  if (( score < 50 )); then
    echo "[$(date -u)] health=$score < 50 — skipping cycle." >> reports/runs/launchd.log
    exit 0
  fi
fi

# Cooldown: don't double-fire if last wake was < 5 min ago
if [[ -f reports/runs/last_wake.ts ]]; then
  age=$(( $(date -u +%s) - $(cat reports/runs/last_wake.ts) ))
  if (( age < 300 )); then
    exit 0
  fi
fi
date -u +%s > reports/runs/last_wake.ts

# Quota gate (rate-limit awareness)
if [[ -f reports/quota-rate-limit-until.ts ]]; then
  until_ts=$(cat reports/quota-rate-limit-until.ts)
  if (( $(date -u +%s) < until_ts )); then
    exit 0
  fi
  rm -f reports/quota-rate-limit-until.ts
fi

# Termination check: Overall L >= target
target_level=${AUTODEV_TARGET_L:-5}
if [[ -f LEVEL.md ]]; then
  overall=$(grep -oE 'Overall L = [0-9]+' LEVEL.md | grep -oE '[0-9]+')
  if [[ -n "$overall" ]] && (( overall >= target_level )); then
    cat > reports/AUTODEV_DONE.md <<EOF
# AutoDev L7 mission complete

Overall L = $overall reached target $target_level at $(date -u).
launchd will keep checking but no further cycles will run.

To resume work toward higher L:
  rm reports/AUTODEV_DONE.md
  Optionally raise AUTODEV_TARGET_L env (default 5).
EOF
    exit 0
  fi
fi

# Run one cycle via claude -p
mkdir -p reports/runs
ts=$(date -u +%Y%m%d-%H%M%S)
log="reports/runs/${ts}.log"

echo "[${ts}] Cycle dispatch starting" > "$log"

# 45-min hard timeout on the claude -p invocation
timeout 2700 claude -p "$(cat scripts/autodev_cycle_prompt.md)" \
  --dangerously-skip-permissions \
  --max-turns 100 \
  >> "$log" 2>&1
cycle_exit=$?

echo "[$(date -u)] cycle exit=$cycle_exit" >> "$log"

# Rate-limit detection
if grep -qE 'rate.?limit|429|too many requests' "$log"; then
  echo "$(($(date -u +%s) + 3600))" > reports/quota-rate-limit-until.ts
  echo "[$(date -u)] rate-limit detected, backing off 1h" >> "$log"
fi

# Timeout exit (124 from `timeout`)
if (( cycle_exit == 124 )); then
  echo "[$(date -u)] cycle timed out at 45min, will retry next wake" >> "$log"
fi

exit 0   # always 0 so launchd doesn't enter ThrottleInterval
```

Tests (`tests/test_autodev_continuous_cycle.py`):
- Stop conditions exit 0 cleanly (DONE, STOPSWITCH, blocked-24h, health<50)
- Cooldown < 5 min prevents double-fire
- Rate-limit backoff respected
- Timeout exit handled
- Idempotent re-invocation

### Cycle 26 — Build `scripts/autodev_cycle_prompt.md`

The actual prompt fed to `claude -p` on each wake. Self-contained, runs ONE cycle, exits.

```markdown
You are the AutoDev L7 supervisor, running in headless one-shot mode.

Execute exactly ONE wake-cycle per AUTODEV_L7_MASTER_PROMPT.md §4 protocol.
No interactive prompts. No clarifying questions. No multi-cycle ambition.

ORIENT (silent, in your head):
- Read STATE.md, last 10 lines of CHANGELOG.md, BACKLOG.md top 3, LEVEL.md,
  FAILURES.md (all), CONTEXT.md, and BLOCKED.md if it exists.

DECISIONS:
- If BLOCKED.md is non-empty: do nothing this cycle. Exit 0.
- If overall L >= AUTODEV_TARGET_L (default 5): create reports/AUTODEV_DONE.md
  and exit 0.
- Otherwise: pick the lowest-capable rubric dimension. Run `scripts/propose_next_track.py`
  and prefer its output. Fall back to BACKLOG.md top-of-list with capable prereqs.

ACT (the actual cycle):
- Follow §4 steps 1-10 exactly. Tag rollback. PLAN. preflight against FAILURES.md.
  Implement (TDD, atomic commits). VERIFY (pytest + compute_level --check + doctor).
  RECORD (CHANGELOG one-liner, STATE rewrite, BACKLOG progress, ADR if applicable,
  cycles/<id>/REPORT.md).
- Atomic commit on autoevo/<cycle-id>/<slug> branch.

CONSTRAINTS:
- §0 hard constraints. §16 tone & discipline. §13 termination checklist.
- ADR-0008 codex budget guard applies to every codex call.
- 45-min wall-clock budget for this cycle. If you hit it, rollback to autoevo/pre-<id>
  tag, mark RESULT.md=TIMEOUT, write to FAILURES.md, exit.
- One dimension by one increment. No multi-track ambition.
- No `git push`. No PR merge. No secret touch. No LEVEL.md hand-edit.

C DIM SPECIAL HANDLING:
- If the cycle is dispatching real work in worktrees/stream-N/, call
  Scheduler.record_cycle_success(cycle_id, deadlock=False) after VERIFY passes.
- This increments the C streak counter in reports/c-deadlock-streak.json.
- The C dimension lifts from L4 to L5 when streak reaches 30.

OUTPUT:
- All artifacts go to disk (cycles/<id>/, CHANGELOG, STATE, LEVEL).
- No interactive output expected. The wake script captures stdout/stderr to a log.

Begin now. Do not narrate the directive. Execute and exit.
```

Tests for the prompt file:
- File exists with expected sections
- Headless-mode markers present (no "ask the human" language)
- 45-min budget mention present
- §0/§13/§16 references present

### Cycle 27 — Build `scripts/install_launchd_autodev.sh`

Generates and installs a launchd plist that runs `autodev_continuous_cycle.sh` every 15 min.

```bash
#!/usr/bin/env bash
# install_launchd_autodev.sh — install/uninstall the AutoDev L7 launchd agent.
# Usage:
#   bash scripts/install_launchd_autodev.sh --install        # install + load
#   bash scripts/install_launchd_autodev.sh --uninstall      # unload + remove
#   bash scripts/install_launchd_autodev.sh --status         # show status

set -u
LABEL="com.lanston.autodev.continuous"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
REPO="/Users/lanston/Desktop/Claude Code/claude-code-247"
INTERVAL=${AUTODEV_INTERVAL_SECONDS:-900}   # 15 min default
TARGET_L=${AUTODEV_TARGET_L:-5}

case "${1:-}" in
  --install)
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array>
    <string>/bin/bash</string>
    <string>${REPO}/scripts/autodev_continuous_cycle.sh</string>
  </array>
  <key>WorkingDirectory</key><string>${REPO}</string>
  <key>EnvironmentVariables</key><dict>
    <key>AUTODEV_TARGET_L</key><string>${TARGET_L}</string>
    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$HOME/Library/pnpm/nodejs/20.20.2/bin</string>
  </dict>
  <key>StartInterval</key><integer>${INTERVAL}</integer>
  <key>StandardOutPath</key><string>${REPO}/reports/runs/launchd.out.log</string>
  <key>StandardErrorPath</key><string>${REPO}/reports/runs/launchd.err.log</string>
  <key>ThrottleInterval</key><integer>60</integer>
  <key>RunAtLoad</key><false/>
</dict></plist>
EOF
    launchctl unload "$PLIST" 2>/dev/null
    launchctl load -w "$PLIST"
    echo "Installed and loaded. Status:"
    launchctl list | grep "$LABEL" || echo "(not yet visible — wait 10s)"
    ;;
  --uninstall)
    launchctl unload -w "$PLIST" 2>/dev/null
    rm -f "$PLIST"
    echo "Uninstalled."
    ;;
  --status)
    launchctl list | grep "$LABEL" || echo "Not loaded."
    [[ -f reports/AUTODEV_DONE.md ]] && echo "Mission complete (AUTODEV_DONE.md present)."
    [[ -f reports/STOPSWITCH ]] && echo "STOPSWITCH present."
    [[ -f BLOCKED.md ]] && echo "BLOCKED.md present."
    if [[ -f LEVEL.md ]]; then
      grep 'Overall L' LEVEL.md
    fi
    ;;
  *)
    echo "Usage: $0 --install | --uninstall | --status"
    exit 1
    ;;
esac
```

Tests (`tests/test_install_launchd.py`):
- Plist generation creates valid XML
- Idempotent install
- Uninstall removes the plist
- Status command output structure

DO NOT auto-install. Leave it for the operator to run `bash scripts/install_launchd_autodev.sh --install`.

### Cycle 28 — Build `scripts/autodev_status_dashboard.sh`

A quick read-only status command for the operator to check progress without pestering the system.

```bash
#!/usr/bin/env bash
# Quick AutoDev status. Read-only.
echo "═══ AutoDev L7 Status @ $(date -u) ═══"
echo
echo "── Overall Level ──"
grep 'Overall L' LEVEL.md 2>/dev/null || echo "  (LEVEL.md missing)"
echo
echo "── Per-dim ──"
head -6 LEVEL.md 2>/dev/null
echo
echo "── C Streak ──"
[[ -f reports/c-deadlock-streak.json ]] && python3 -c "import json; d=json.load(open('reports/c-deadlock-streak.json')); print(f'  current={d.get(\"current\",0)}/30  best={d.get(\"best\",0)}')" || echo "  (no streak yet)"
echo
echo "── Last 5 cycles ──"
tail -5 CHANGELOG.md 2>/dev/null
echo
echo "── Stop conditions ──"
[[ -f reports/AUTODEV_DONE.md ]] && echo "  ✓ AUTODEV_DONE.md present"
[[ -f reports/STOPSWITCH ]] && echo "  ⚠ STOPSWITCH present (human halt)"
[[ -f BLOCKED.md ]] && echo "  ⚠ BLOCKED.md present"
[[ -f reports/quota-rate-limit-until.ts ]] && echo "  ⚠ rate-limit backoff until $(cat reports/quota-rate-limit-until.ts | xargs -I {} date -u -r {})"
echo
echo "── Last 10 wake events ──"
tail -10 reports/runs/launchd.log 2>/dev/null || echo "  (no launchd log yet)"
echo
echo "── launchctl status ──"
launchctl list | grep autodev 2>/dev/null || echo "  (not installed)"
```

Make it executable. Add to autodev_doctor.sh as a check.

### Cycle 29 — Smoke test the continuous infrastructure

Run `scripts/autodev_continuous_cycle.sh` ONCE in foreground (no launchd):

```bash
# Expected: exits 0 within 60 min, produces cycles/<new-id>/ + reports/runs/<ts>.log
AUTODEV_TARGET_L=5 bash scripts/autodev_continuous_cycle.sh
```

Verify it actually did a real cycle (check CHANGELOG for new entry). If not, debug. Until this works in foreground, the launchd path can't be trusted.

---

## Phase C — Handoff documentation

### Cycle 30 — Write `reports/L7-handoff-to-launchd.md`

Comprehensive handoff doc for the operator. Sections:

1. **What's running 24/7 after install**: the cycle of stop-checks → claude -p → cycle work
2. **How to install** (one command): `bash scripts/install_launchd_autodev.sh --install`
3. **How to monitor**: `bash scripts/autodev_status_dashboard.sh`
4. **How to pause**: `touch reports/STOPSWITCH` (graceful — current cycle completes then no more dispatch)
5. **How to resume**: `rm reports/STOPSWITCH`
6. **How to fully stop**: `bash scripts/install_launchd_autodev.sh --uninstall`
7. **How to inspect failures**: tail `reports/runs/launchd.err.log`
8. **What "done" looks like**: `cat reports/AUTODEV_DONE.md` exists, launchd keeps polling but does nothing
9. **Cost monitoring**: tail `reports/codex-spend.jsonl`; weekly check on OpenAI dashboard
10. **When to come back manually**: 
    - BLOCKED.md exists (human decision needed)
    - ALERT.md exists (Codex disagreement or other signal)
    - Overall L stuck at the same value for >5 days (system needs new tracks)

### Cycle 31 — Milestone-3 report

Per §18: write `reports/milestone-3.md`:
- Cumulative level progress since Cycle 0 (Bootstrap)
- All level-up events with dates and root causes
- Codex spend MTD
- Top patterns from FAILURES.md
- Honest assessment: did the past 30 cycles correlate with actual system quality?
- Three recommended tracks for the next 30 cycles (will probably be 28 C-streak + 2 polish)

---

## Phase D — Use remaining session time for real cycle work

After Phase A+B+C complete (~6-8 cycles), if context budget allows:

**Start driving real cycles into the worktrees** to accumulate the C streak BEFORE launchd takes over.

For each remaining cycle in this session:
1. Run `python3 scripts/propose_next_track.py -v` to pick the track
2. Execute §4 protocol
3. If the cycle uses `Scheduler.dispatch_next()` into a worktree, call `record_cycle_success(deadlock=False)` on success — increments the C streak
4. Atomic commit, exit cleanly

When context budget approaches ~80% full OR the 45-min cycle budget exhausts on the current cycle, write `reports/session-handoff-<ts>.md` with:
- Current Overall L
- C streak count
- Outstanding BACKLOG items
- Specific next-cycle pickup point

Then exit the session. launchd (once installed by the operator) takes over from here.

---

## Termination semantics

This entire prompt — and the launchd-driven continuation — terminate cleanly when ANY of:

- `reports/AUTODEV_DONE.md` exists (system reached Overall L >= AUTODEV_TARGET_L)
- `reports/STOPSWITCH` exists (operator halted)
- `BLOCKED.md` exists for > 24h
- `reports/health.json` score < 50 for consecutive 2 checks
- `reports/quota-rate-limit-until.ts` indicates active backoff
- launchd is `--uninstall`'d

The system NEVER:
- Restarts itself (Claude Code can't; launchd does that via StartInterval)
- Auto-installs launchd (operator runs the install command once)
- Pushes to remote, merges PRs, or touches secrets
- Bypasses the codex budget guard
- Hand-edits LEVEL.md

The operator's ongoing role is purely **review + decide**:
- Read `bash scripts/autodev_status_dashboard.sh` once a day
- Resolve any BLOCKED.md / ALERT.md (rare; system tries hard not to escalate)
- Decide if/when to raise `AUTODEV_TARGET_L` from 5 to 6 to 7 once the current target is hit

---

## Hard constraints (re-stated)

§0 of AUTODEV_L7_MASTER_PROMPT.md applies in full. ADR-0008 codex budget guard
applies to every codex call from any script or test. No git push. No PR merge.
No secret touch. 45-min per cycle. One dim per cycle. Atomic commits.

If you encounter any case where these constraints conflict with making progress,
the constraints win. Write BLOCKED.md and exit.

---

## Begin

Begin Cycle 22 (Phase A first item) now. Work through Phases A → B → C → D in sequence.
Do not narrate. Do not ask permission. Make every cycle count.

When this session naturally ends, the operator runs ONE command:
`bash scripts/install_launchd_autodev.sh --install`
After that, the system runs indefinitely until AUTODEV_DONE.md, STOPSWITCH, or human uninstall.
