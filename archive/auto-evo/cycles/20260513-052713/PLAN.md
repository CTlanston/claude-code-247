# Cycle 20260513-052713 PLAN — Phase B Cycle 29 (foreground smoke)

## Target dimension

INFRA (no dim move). Phase B step 5 of the launchd-driven 7×24
infrastructure stack. **Final Phase B cycle**: end-to-end smoke
test of the wake script's full state machine, run multiple times
in sequence with realistic stop conditions toggling on/off.

## Specific gap being closed

The existing 15 unit tests in
`tests/test_autodev_continuous_cycle.py` cover each branch of
the wake script in isolation. But they don't cover the
*time-sequenced state machine* — what happens when the same
launchd dispatch fires 10 times in sequence as it would in
production? Does the cooldown carry between wakes? Does
rate-limit detection survive across consecutive runs? Does the
target-L AUTODEV_DONE.md trip correctly when LEVEL.md updates
between wakes?

This cycle ships an end-to-end smoke test that runs the wake
script 5+ times in sequence with the disk state changing
between runs, verifying the full state machine.

## Change being made

1. Create `tests/test_autodev_continuous_cycle_smoke.py` — a
   single end-to-end test class with at least one
   multi-wake scenario per state-machine path:

   - **scenario 1: bootstrap → cooldown → dispatch**
     - Wake 1: no last_wake.ts → dispatch claude (stub)
     - Wake 2 (immediate): last_wake.ts < 5min → skip
     - Wake 3 (after fast-forwarding last_wake.ts by 600s):
       dispatch claude (stub) again
   - **scenario 2: rate-limit → wait → cleanup → dispatch**
     - Wake 1: stub claude emits "rate limit" → backoff stamp
       written
     - Wake 2 (immediately after): rate-limit active → skip
     - Wake 3 (after fast-forwarding rate-limit stamp into the
       past): cleanup the stamp file, then dispatch
   - **scenario 3: target-L reached → AUTODEV_DONE.md written →
     subsequent wakes skip**
     - Wake 1: LEVEL.md says Overall L=5, AUTODEV_TARGET_L=5
       → wake writes reports/AUTODEV_DONE.md, no claude
     - Wake 2 (immediate): AUTODEV_DONE.md present → skip, no
       claude
   - **scenario 4: BLOCKED → unblock → dispatch**
     - Wake 1: BLOCKED.md present, < 1 min old → skip
     - Wake 2 (after deleting BLOCKED.md): dispatch
   - **scenario 5: STOPSWITCH → remove → dispatch**
     - Wake 1: STOPSWITCH present → skip
     - Wake 2 (after removing STOPSWITCH): dispatch

   Each scenario uses tmp_path + a stub claude (same pattern as
   the unit tests). The key invariant: across all 5 scenarios,
   the wake script ALWAYS exits 0 and is idempotent.

2. Add a Phase B summary section to `CHANGELOG.md`'s normal
   one-liner.

## Acceptance criteria

- [x] `tests/test_autodev_continuous_cycle_smoke.py` adds ≥5
      multi-wake scenarios
- [x] `pytest tests/ -q` green (existing 466 + new ≥5 = ≥471)
- [x] `compute_level --check` green (after propose-first)
- [x] `autodev_doctor.sh`: 13/0/2

## Files to touch (closed set)

- `tests/test_autodev_continuous_cycle_smoke.py` (new)
- `CHANGELOG.md` (one line — Phase B complete)
- `BACKLOG.md` (mark Cycle 29 done, surface Cycle 30 P0)
- `STATE.md` (rewrite — Phase B 5/5)
- `cycles/20260513-052713/PLAN.md` (this)
- `cycles/20260513-052713/REPORT.md`
- `cycles/20260513-052713/RESULT.md`
- `cycles/20260513-052713/next-track-proposal.json`
- `reports/zero-deadlock-streak.txt` (bump 9→10)
- `reports/cycle-history.jsonl` (append)

## Files forbidden to touch

- `.env*`, `secrets/**`, `LEVEL.md` (computed), anything in §0.
- `scripts/autodev_continuous_cycle.sh` itself — this cycle is
  pure-add tests, NOT a wake-script change. Any drift surfaced
  by the smoke test would need a separate cycle to fix.

## Rollback plan

`git reset --hard autoevo/pre-20260513-052713` is the fallback.
Pure-add tests; no risk.

## Risk score

low. New test file only.

## FAILURES.md pre-flight result

Keywords: smoke, wake, dispatch, cooldown, rate-limit, BLOCKED,
STOPSWITCH, AUTODEV_DONE.

- No FAILURES.md matches. Smoke testing is a net-new exercise on
  this codebase; no prior failures recorded.

## Open questions / blockers

None.
