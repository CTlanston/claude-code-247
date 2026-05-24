# Cycle 20260514-201707 PLAN — Cycle ε (hourly cadence + DONE celebration)

## Target dimension
**E — Self-improvement** (the supervisor now decides for itself when
it's done — 5 consecutive cycles at or above `AUTODEV_TARGET_L`
trips a comprehensive `AUTODEV_DONE.md` that gracefully halts
further dispatch). Secondary: **S** (a new gate: don't celebrate
on a one-cycle level-up; require stability).

## Specific gap being closed
Current wake script writes `AUTODEV_DONE.md` the FIRST time
`Overall L >= TARGET_L`. That's brittle:
- A flaky cycle could nudge L over the line and immediately quiesce
  the supervisor even though the level isn't load-bearing.
- The DONE.md content is minimal (just "Overall L = X reached
  target Y"). Operators get no summary of what was achieved.
- The launchd cadence (15 min vs 1 hour) is only env-tunable;
  there's no operator-readable canonical setting in HUMAN_CONFIG.

Cycle ε closes all three: 5-cycle stability gate, expanded DONE.md
schema, and HUMAN_CONFIG-as-canonical for the cadence.

## Change being made
Three pieces (smallest vertical slice for each):

1. **`scripts/autodev_continuous_cycle.sh`** — replace the
   "Termination check" block:
   - When `overall >= TARGET_L`: increment
     `reports/level5-stability.txt` (default 0); log progress.
     If counter `>= AUTODEV_STABILITY_THRESHOLD` (default 5):
     write `reports/AUTODEV_DONE.md` with the expanded schema
     (final Overall L, per-dim levels from LEVEL.md, total cycles
     from CHANGELOG count, total commits from `git rev-list`,
     C streak HWM, "honest assessment" boilerplate).
   - When `overall < TARGET_L`: reset stability counter (remove
     the file). Drops in level reset the celebration window.
   - `AUTODEV_SKIP_STABILITY_GATE=1` env disables the gate
     (one-shot DONE.md still works for emergency stop).

2. **`scripts/install_launchd_continuous.sh`** — when
   `AUTODEV_INTERVAL_SECONDS` is unset, fall back to
   `grep -oE 'launchd_interval_seconds:\s*[0-9]+' HUMAN_CONFIG.md`
   to extract the canonical value. If both are unset, keep the
   existing 900 default.

3. **`HUMAN_CONFIG.md`** — add `launchd_interval_seconds: 900`
   under the existing `runtime:` block with a comment
   recommending 3600 for steady-state operation.

Plus 4 regression tests + `docs/adr/0013-stability-gate-and-done-schema.md`.

## Acceptance criteria
- [ ] `pytest -q` green.
- [ ] `scripts/compute_level.py --check` exit 0.
- [ ] `scripts/autodev_doctor.sh` exit 0.
- [ ] Cycle ε tests cover: stability increments at L>=target;
      stability resets on drop; DONE.md NOT written before 5th
      consecutive; DONE.md IS written on 5th consecutive; DONE.md
      content has the expanded schema (per-dim levels, total
      cycles, total commits).
- [ ] Install script test: HUMAN_CONFIG.md interval value is used
      when env var is unset; env var wins when both are set.

## Files to touch (closed set)
- `scripts/autodev_continuous_cycle.sh`
- `scripts/install_launchd_continuous.sh`
- `HUMAN_CONFIG.md`
- `tests/test_autodev_continuous_cycle.py` (extend)
- `tests/test_install_launchd_continuous.py` (extend, 1-2 tests)
- `docs/adr/0013-stability-gate-and-done-schema.md` (new)
- `cycles/20260514-201707/{PLAN,RESULT,REPORT,STATE.before,next-track-proposal}.md`
- `CHANGELOG.md`, `STATE.md`, `reports/zero-deadlock-streak.txt`,
  `reports/cycle-history.jsonl`

## Files forbidden to touch
- `.env*`, `secrets/**`, `LEVEL.md`, `FAILURES.md`, ADRs 0000-0012,
  the live plist, `scripts/autodev_self_repair.sh` (δ's scope,
  complete)

## Rollback plan
`git reset --hard autoevo/pre-20260514-201707`

## Risk score
**low.** Termination-block refactor is a small replacement; the
"write DONE.md immediately" behavior moves to "wait for 5
consecutive". Existing test
`test_target_l_reached_writes_done_md` will need to update its
expectation OR be skipped via the new `AUTODEV_SKIP_STABILITY_GATE`
env. I'll opt for the latter (preserves test as the "skip-gate
emergency stop" assertion) and add the new stability tests
alongside.

## FAILURES.md pre-flight result
`grep -nE 'stability|DONE.md|level5|celebration' FAILURES.md`
→ 0 hits. Novel territory.

## Open questions / blockers
None.
