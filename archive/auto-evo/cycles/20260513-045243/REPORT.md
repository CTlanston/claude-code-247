# Cycle 20260513-045243 Report — Track T6 (live sanity script)

## Verdict
PASS — T-dim L5 → L6. Phase A item 1 of 3 done.

## Level changes
| Dim | Before | After |
|---|---|---|
| M | 7 | 7 (max) |
| S | 7 | 7 (max) |
| R | 7 | 7 (max) |
| C | 4 | 4 (sole floor; streak 2→3) |
| T | 5 | **6** |
| E | 6 | 6 |

Overall L = 4 (unchanged; C is sole floor; streak now 3/30).

## Change

1. **`scripts/v5_live_sanity.sh`** (new, executable, ~85 lines):
   - Dry-run default: simulates one inner-engine state-machine tick
     (new → planning → coding → reviewing → ci_running → human_review)
     and writes JSON to `reports/live-sanity/<ts>.json` with
     `started_at`, `ended_at`, `mode`, `state_transitions`, `result`,
     `notes`.
   - `AUTODEV_LIVE=1` requires `HUMAN_CONFIG.runtime.live_sanity_authorized=true`
     (parsed from HUMAN_CONFIG.md). Without the flag → exit 2 with
     refusal message. With the flag → exit 3 (placeholder; real live
     path is a future Track L2/L3).
   - `AUTODEV_LIVE_SANITY_DIR` env override for tests.
   - `AUTODEV_HUMAN_CONFIG` env override for tests.

2. **`reports/live-sanity/`** (new dir with `.gitkeep`): tracked
   directory so compute_level T-L6 detection finds it.

3. **`tests/test_live_sanity.py`** (new, 8 tests, all green):
   - script exists + executable
   - dry-run exits 0 + writes JSON artifact
   - JSON schema validity
   - two consecutive dry-runs write distinct timestamped files
   - AUTODEV_LIVE=1 without config-flag → exit 2 refusal
   - AUTODEV_LIVE=1 with config-flag → exit 3 placeholder
   - started_at ≤ ended_at invariant

4. **`HUMAN_CONFIG.md`**: added `runtime.live_sanity_authorized: false`
   under the existing codex section. The flag is the second gate
   (env var = first gate) for live mode.

5. **`scripts/autodev_doctor.sh`**: 1-line check that
   `scripts/v5_live_sanity.sh` exists + is executable. Doctor now
   reports 12 passed (was 11).

## Files modified
```
scripts/v5_live_sanity.sh                (new, executable, ~85 lines)
tests/test_live_sanity.py                (new, 8 tests, ~150 lines)
reports/live-sanity/.gitkeep             (new)
HUMAN_CONFIG.md                          (+ live_sanity_authorized: false)
scripts/autodev_doctor.sh                (+ 7-line check block)
CHANGELOG.md, BACKLOG.md, STATE.md, LEVEL.md
reports/zero-deadlock-streak.txt         (3, bumped from 2)
reports/cycle-history.jsonl              (+ 1 entry for cycle 22)
cycles/20260513-045243/*
```

## Verify
- pytest: 355 passed, 2 skipped, 0 failed
- compute_level: T=L6 ("Live sanity script + logs present")
- compute_level --check: passed (T lifted, no regression)
- doctor: 12/0/2

## What this DOESN'T do
- Does NOT yet implement the real live tick (exit 3 placeholder).
  Reserved for a future cycle once the operator opts in via the
  HUMAN_CONFIG flag.
- Does NOT change overall L. C remains the sole floor at L4.

## Next track
Per the AUTODEV_L7_CONTINUOUS_RUN.md Phase A plan: **Cycle 23 — Track T7**
(golden-diff fixtures). Lifts T 6 → L7 (max).

## Wall clock
~12 minutes. Most of the cycle was on the test file (8 tests with
shell-subprocess invocations and JSON schema assertions); the script
itself is small.
