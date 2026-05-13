# L7 Handoff — turning the system over to launchd

> **Audience**: the human operator (you) who has been driving cycles
> in this session interactively. This doc explains how to install the
> launchd-driven 7×24 autonomous run AND, critically, when you should
> come back manually.
>
> **Status**: Phase A + Phase B complete (M=S=R=T=E=7, C=4 → Overall L=4).
> launchd infrastructure is on disk but NOT yet installed. The single
> command below installs it.

---

## Quick reference card (the 5 most-common operator commands)

```bash
# 1. INSTALL — run this exactly once after Phase C is complete
bash scripts/install_launchd_continuous.sh --install

# 2. MONITOR — read-only one-screen status (run anytime)
bash scripts/autodev_status_dashboard.sh

# 3. PAUSE — current cycle finishes, no more dispatch until resume
touch reports/STOPSWITCH

# 4. RESUME
rm reports/STOPSWITCH

# 5. FULLY STOP (unload from launchd)
bash scripts/install_launchd_continuous.sh --uninstall
```

That's it. Everything else in this doc is detail.

---

## 1. What runs 24/7 after install

After you run `--install`, macOS launchd schedules the agent
`com.lanston.autodev.continuous` to fire every **15 minutes** (by
default; configurable via `AUTODEV_INTERVAL_SECONDS`). On each
firing, `scripts/autodev_continuous_cycle.sh` runs and does this:

```
WAKE FIRES (every 15 min)
  │
  ├─ Is reports/AUTODEV_DONE.md present?       → exit 0 (mission done)
  ├─ Is reports/STOPSWITCH present?            → exit 0 (human halt)
  ├─ Is BLOCKED.md present and < 24h old?      → exit 0
  ├─ Is reports/health.json score < 50?        → exit 0
  ├─ Is last_wake.ts < 5 min ago? (cooldown)   → exit 0
  ├─ Is quota-rate-limit-until.ts in future?   → exit 0
  ├─ Has Overall L reached AUTODEV_TARGET_L?   → write AUTODEV_DONE.md, exit 0
  │
  └─ Otherwise: invoke claude -p with the cycle prompt
        │
        └─ One §4 wake-cycle runs:
              ORIENT → PLAN → ACT → VERIFY → RECORD → EXIT
              (45-min wall-clock budget; rollback tag on entry;
               atomic commit on autoevo/cycle-<N>/<slug> branch)

EXIT 0 — always 0, even on failure, so launchd doesn't enter
         ThrottleInterval and lock dispatch out.
```

The wake script captures stdout/stderr per cycle to
`reports/runs/<ts>.log`. The cycle itself writes the canonical
artifacts to `cycles/<id>/PLAN.md` + `REPORT.md` + `RESULT.md`,
appends one line to `CHANGELOG.md`, rewrites `STATE.md`, and
makes one atomic git commit on a new feature branch.

---

## 2. How to install

```bash
bash scripts/install_launchd_continuous.sh --install
```

What this does:
- Writes a plist to `$HOME/Library/LaunchAgents/com.lanston.autodev.continuous.plist`
- Runs `launchctl load -w` on it (so it survives reboots)
- Confirms with a `launchctl list | grep autodev` line

Idempotent: running `--install` twice leaves one plist with the
same bytes. The script unloads first, then loads, so re-running
after editing env vars works.

**Note**: this is the L7 *continuous* agent. The repo also has a
pre-existing v3 supervisor agent
(`scripts/install_launchd_autodev.sh`, label
`com.autodev.supervisor`). They are independent and can coexist.
This doc only covers the L7 agent.

---

## 3. How to monitor

```bash
bash scripts/autodev_status_dashboard.sh
```

Outputs a one-screen status with 7 sections:
- **Overall Level** (from LEVEL.md)
- **Per-dim** (M/S/R/C/T/E levels)
- **C Streak** (current/30 + cycles remaining to C-L5)
- **Last 5 cycles** (tail of CHANGELOG.md)
- **Stop conditions** (any AUTODEV_DONE / STOPSWITCH / BLOCKED /
  active rate-limit window)
- **Last 5 wake events** (tail of `reports/runs/launchd.log`)
- **launchctl registration** for both L7 and v3 agents

The dashboard is read-only. Run it anytime.

---

## 4. How to pause

```bash
touch reports/STOPSWITCH
```

What happens:
- Any cycle currently mid-execution **finishes** (graceful — the
  pause doesn't interrupt an active cycle)
- Every subsequent wake (every 15 min) sees `STOPSWITCH` and
  exits 0 without invoking claude
- The dashboard surfaces it: `⚠ reports/STOPSWITCH present — human halt active`

Use this when you want to:
- Investigate something the system did
- Make a manual edit without racing the next cycle
- Take a break for hours/days

---

## 5. How to resume

```bash
rm reports/STOPSWITCH
```

The next wake (within 15 min) dispatches normally.

---

## 6. How to fully stop (unload from launchd)

```bash
bash scripts/install_launchd_continuous.sh --uninstall
```

What this does:
- `launchctl unload -w` the plist
- Deletes `$HOME/Library/LaunchAgents/com.lanston.autodev.continuous.plist`
- Idempotent (no-op if not installed)

After uninstall, launchd will no longer fire the wake script.
The repo state is untouched. Re-install with `--install` whenever.

---

## 7. How to inspect failures

```bash
# Aggregate launchd-level log (every wake's exit code + dispatch summary)
tail -50 reports/runs/launchd.log

# Per-cycle stdout/stderr (each wake's log)
ls -lt reports/runs/*.log | head -10
tail -100 reports/runs/<most-recent-ts>.log

# Cycle-level results
ls -lt cycles/ | head -10
cat cycles/<most-recent-cycle-id>/RESULT.md   # PASS | FAIL_AS_DATA | TIMEOUT
cat cycles/<most-recent-cycle-id>/REPORT.md   # what happened, why

# FAILURES.md — every documented failure with root cause + fix
tail -200 FAILURES.md

# ALERT.md (if it exists) — Codex disagreement or other escalation
cat ALERT.md 2>/dev/null
```

The system is designed so failure is data: a FAIL_AS_DATA cycle
still counts and writes a FAILURES.md entry. Don't worry about
seeing failed cycles in the log — that's the learning loop
working.

---

## 8. What "done" looks like

```bash
cat reports/AUTODEV_DONE.md
```

When Overall L reaches `AUTODEV_TARGET_L` (default 5), the wake
script writes this file and exits 0. Subsequent wakes see it
and skip immediately without invoking claude.

The system "rests" — launchd keeps polling every 15 min, but
each poll is a single skip. No more cycles run until you either:
- Remove `reports/AUTODEV_DONE.md` and raise `AUTODEV_TARGET_L`
  via the plist's `EnvironmentVariables` (then re-`--install`)
- Or uninstall the agent and accept that the work is done

---

## 9. Cost monitoring

This system is designed to run on the **subscription** Claude Code
session (`sk-ant-oat01-*`). Per-call cost should be $0 from
Anthropic's side — Guardian masks any cost estimates the CLI
emits per `FAIL-0003` / ADR-0001.

The optional cross-model Codex Reviewer (when wired) costs
OpenAI Codex tokens. Per ADR-0008:

```bash
# Per-call codex spend log
tail -20 reports/codex-spend.jsonl

# Aggregate weekly check (visit https://platform.openai.com)
```

If a codex call would exceed the daily cap, `codex_budget_guard.sh`
refuses it and the cycle proceeds without Codex's opinion. The
N-of-3 review panel handles Codex abstention correctly.

**No paid Anthropic API calls happen, ever.** §0 rule 1 forbids
it.

---

## 10. When to come back manually

The system tries hard not to escalate. Most things resolve
themselves. Come back manually only when one of these is true:

### `BLOCKED.md` exists

Some cycle hit a constraint it couldn't resolve. Read `BLOCKED.md`
(it's short and structured). Either:
- Fix the underlying issue (e.g. install a missing tool) and
  delete `BLOCKED.md`
- Or accept the block, mark it via ADR, and leave it for a
  future cycle when conditions change

The wake script will skip every cycle until `BLOCKED.md` is removed
(or >24h old, in which case the system might decide to retry).

### `ALERT.md` exists

This is rare. It indicates a quality signal you should review:
- Claude ↔ Codex disagreement (cross-model review panel split)
- N-of-3 panel split (mixed signals)
- Adversarial reviewer rejected something Claude approved

Read `ALERT.md`, decide if the work is safe to land, and either
delete the file or add an ADR documenting your decision.

### Overall L stuck at the same value for > 5 days

The system advances by picking the lowest *capable* rubric
dimension. If no dimension is capable (all have unmet
prerequisites), no progress happens. This usually means:
- `BACKLOG.md` needs new tracks
- A prerequisite is environmental (e.g. `codex` CLI not installed)
  and you need to set it up
- The rubric ceiling has been reached for this codebase's
  current scope

Read `BACKLOG.md`, add tracks, or accept the ceiling.

---

## Architecture overview

```
┌─────────────────────────────────────────────────────────────┐
│  macOS launchd                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  com.lanston.autodev.continuous (plist)              │   │
│  │  StartInterval: 900s                                 │   │
│  │  RunAtLoad: false                                    │   │
│  │  ThrottleInterval: 60s                               │   │
│  └──────────────────────────────────────────────────────┘   │
└────────────────────────┬────────────────────────────────────┘
                         │ every 15 min
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  scripts/autodev_continuous_cycle.sh (the wake script)      │
│                                                             │
│  1. Stop-condition checks (DONE/STOPSWITCH/BLOCKED/health/  │
│     cooldown/rate-limit/target-L) — any one halts dispatch  │
│  2. If clear: invoke `claude -p $(cat                       │
│     scripts/autodev_cycle_prompt.md)` with 45-min timeout   │
│  3. Detect rate-limit in cycle log → write backoff stamp    │
│  4. ALWAYS exit 0 (no ThrottleInterval)                     │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  claude -p reads scripts/autodev_cycle_prompt.md            │
│  and executes ONE §4 wake-cycle:                            │
│                                                             │
│  ORIENT (read STATE/CHANGELOG/FAILURES/LEVEL/BACKLOG/...)   │
│    ↓                                                        │
│  DECISIONS (skip if BLOCKED/DONE/STOPSWITCH; else propose)  │
│    ↓                                                        │
│  ACT (tag rollback, PLAN, preflight, TDD, commit)           │
│    ↓                                                        │
│  VERIFY (pytest + propose_next_track --for-cycle THEN       │
│          compute_level --check + doctor)                    │
│    ↓                                                        │
│  RECORD (CHANGELOG + STATE + BACKLOG + REPORT + RESULT +    │
│          cycle-history.jsonl + streak counter)              │
│    ↓                                                        │
│  EXIT (atomic commit on autoevo/cycle-<N>/<slug>, exit 0)   │
└─────────────────────────────────────────────────────────────┘
```

The system is **single-threaded inside one cycle** (a wake-cycle
finishes before the next can start, modulo 5-min cooldown).
Concurrency happens *across* cycles via git worktrees (Dim C).

---

## FAQ

**Q: Why is it still running? I uninstalled launchd.**
A: Maybe you uninstalled the v3 supervisor agent
(`com.autodev.supervisor`) instead of the L7 continuous one
(`com.lanston.autodev.continuous`). Run
`launchctl list | grep autodev` to see what's loaded. The L7
uninstaller is `scripts/install_launchd_continuous.sh --uninstall`.

**Q: Did my install work?**
A: Run `bash scripts/install_launchd_continuous.sh --status`. It
prints whether the plist exists, whether it's loaded into
launchctl, and the current Overall L. Or run the dashboard:
`bash scripts/autodev_status_dashboard.sh`.

**Q: How do I see what cycle was last dispatched?**
A: `tail -5 CHANGELOG.md` — each cycle adds one line. Or
`ls -lt cycles/ | head -5` for the most recent cycle folders.

**Q: AUTODEV_DONE.md appeared. Now what?**
A: Mission complete at the configured target L. Read the file
(it's short — Overall L value + UTC timestamp). Decide:
- Accept the result: nothing to do; launchd keeps polling but
  does nothing each poll
- Raise the target: edit the plist's `AUTODEV_TARGET_L` value,
  delete `reports/AUTODEV_DONE.md`, run `--install` again to
  reload
- Stop entirely: `--uninstall`

**Q: How do I raise the target L?**
A: Edit `$HOME/Library/LaunchAgents/com.lanston.autodev.continuous.plist`
and bump `AUTODEV_TARGET_L`'s string value (e.g. from 5 to 6).
Then re-run `--install` to reload. Or, more cleanly:
`AUTODEV_TARGET_L=6 bash scripts/install_launchd_continuous.sh --install`.

**Q: The cost looks too high. How do I check?**
A: This system shouldn't spend Anthropic API dollars (§0 rule 1).
Codex review is the only paid surface; `tail reports/codex-spend.jsonl`
shows per-call cost. If you see API spend on Anthropic, something
is wrong — check `reports/billable.jsonl` and the FAIL-0003 lineage.

**Q: How do I add a new track for the system to work on?**
A: Edit `BACKLOG.md`. Add a `- [ ] [Track XYZ] ...` entry under
P0/P1/P2 as appropriate. The next wake will pick it up if its
prerequisites are met. Or just let `propose_next_track.py` keep
running its scoring loop — it'll prefer floor-dim tracks.

---

## A note on what this system *cannot* do

(Repeated from L7 §1 — "the honest ceiling".)

This system is good at: well-spec'd utility functions, isolated
bugs with reproducer tests, refactors within a clear contract,
test coverage increases, documentation, repetitive small features.

This system is mediocre at: multi-component features touching
multiple subsystems, fixes where root cause is ambiguous, tasks
where the spec leaves design choices to the implementer, anything
requiring "good enough" vs. "ship-worthy" judgment.

This system **fails** at: product decisions, UX judgment,
stakeholder communication, novel architectural choices, crisis
response.

Don't expect it to make those calls. Do expect it to discipline
itself, accumulate failures, refuse repeat mistakes, and grind
out small verified improvements 24/7.

---

## Resources

- `AUTODEV_L7_MASTER_PROMPT.md` — the canonical L7 spec (the
  cycle protocol, rubric, hard constraints)
- `AUTODEV_L7_CONTINUOUS_RUN.md` — this session's mission directive
- `CONTEXT.md` — system invariants
- `FAILURES.md` — every documented failure
- `CHANGELOG.md` — every cycle's one-line summary
- `LEVEL.md` — current rubric position
- `BACKLOG.md` — what's queued
- `STATE.md` — current state snapshot
- `docs/adr/*.md` — architectural decisions
- `cycles/<id>/REPORT.md` — per-cycle detail

You don't need to read these to operate the system. You only
need this doc + the 5-command quick reference at the top.
