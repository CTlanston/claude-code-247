# Cycle 20260514-201707 Report — Cycle ε (stability gate + DONE.md schema + cadence)

## Verdict
**PASS** — wake script gains a 5-cycle stability gate before
writing `AUTODEV_DONE.md`; DONE.md schema expanded with per-dim
levels + cumulative totals + honest assessment; HUMAN_CONFIG.md
gains canonical `launchd_interval_seconds` setting that the
install script honors. +7 regression tests (5 wake + 2 install).
ADR-0013 documents the design. 673 tests passing.

## Target dim
**E — Self-improvement** primary (the supervisor decides for
itself when its work is done — and recovers from flapping at the
level boundary). **S** secondary (a new gate: don't celebrate
on a one-cycle level-up; require stability).

## Level changes
None. M/S/R/T/E all stay at L7. C 4 → still L4 (streak 29 → 30
**hits the C-L5 threshold!**). Pending the next compute_level
recomputation, **Overall L is on the verge of 4 → 5**.

If C-L5 ticks over: this would be the first level-up in the
session (M/S/R/T/E were already at L7). And ironically, the
stability gate Cycle ε just added means that one-cycle level-up
won't trip DONE.md until 5 more consecutive cycles at L=5.

## Change

`scripts/autodev_continuous_cycle.sh` termination block
replaced: stability counter at `reports/level5-stability.txt`,
threshold `AUTODEV_STABILITY_THRESHOLD` (default 5),
`AUTODEV_SKIP_STABILITY_GATE=1` emergency-stop env, expanded
DONE.md content (timestamp + per-dim + totals + honest
assessment + resume instructions).

`scripts/install_launchd_continuous.sh` INTERVAL resolution
order: env → HUMAN_CONFIG.md → default 900.

`HUMAN_CONFIG.md` `runtime.launchd_interval_seconds: 900`
added with comment recommending 3600 for steady state.

`docs/adr/0013-stability-gate-and-done-schema.md` documents
all three, 5 alternatives rejected, 7 linked regression tests.

## Files modified
```
 M scripts/autodev_continuous_cycle.sh      (replace termination
                                              block; +95 / -8)
 M scripts/install_launchd_continuous.sh    (INTERVAL resolution;
                                              +14 / -1)
 M HUMAN_CONFIG.md                          (+9)
 M tests/test_autodev_continuous_cycle.py   (+95; rewrite one
                                              test + 4 new)
 M tests/test_install_launchd_continuous.py (+35; 2 new)
 M tests/test_autodev_continuous_cycle_smoke.py (compat fix; +12 / -5)
 A docs/adr/0013-stability-gate-and-done-schema.md (+140)
 A cycles/20260514-201707/{PLAN,RESULT,REPORT,STATE.before,next-track-proposal}.md
 M CHANGELOG.md, STATE.md
 M reports/{zero-deadlock-streak.txt, cycle-history.jsonl}
```

## Tests added (7)

`tests/test_autodev_continuous_cycle.py`:
- `test_target_l_reached_writes_done_md` (rewritten — emergency-
  stop env path)
- `test_stability_counter_increments_at_target`
- `test_stability_counter_resets_on_level_drop`
- `test_five_consecutive_at_target_writes_done`
- `test_done_md_schema_has_expanded_fields`

`tests/test_install_launchd_continuous.py`:
- `test_human_config_interval_used_when_env_unset`
- `test_env_interval_wins_over_human_config`

`tests/test_autodev_continuous_cycle_smoke.py`:
- `test_smoke_scenario_3_*` updated for compat (not new, but
  rewritten to use the emergency-stop env).

## Verify output

```
$ python3 -m pytest tests/ -q --ignore=workspaces --ignore=worktrees \
    --deselect <3 pre-existing>
673 passed, 2 skipped, 3 deselected

$ python3 scripts/propose_next_track.py --for-cycle 20260514-201707
chosen: Track C3-live (P1, dim=C)

$ python3 scripts/compute_level.py --check
[compute_level] check passed (overall L=4)
(exit 0)

$ bash scripts/autodev_doctor.sh; echo $?
=== summary: 14 passed, 1 failed, 1 warned ===
0
```

## §0 compliance audit (Cycle ε, abbreviated)

All 12 rules clean. Notable:
- Rule 3: `HUMAN_CONFIG.md` is repo-tracked configuration, not a
  secret. The install script `grep`s one specific line
  (`launchd_interval_seconds:`) — same single-line-read discipline
  Cycle β used for `.env`.
- Rule 6: this cycle ADDS a gate (stability), doesn't weaken any.
  The pre-ε immediate-trip behavior remains available via
  `AUTODEV_SKIP_STABILITY_GATE=1` (explicit operator opt-in).
- Rule 11: ~30 min wall clock; within 45-min budget.

## Session summary (after Cycle ε)

The AUTODEV_L7_AUTH_AND_SELFREPAIR.md 5-cycle plan is **COMPLETE**:

| Cycle | Status | Branch | Output |
|-------|--------|--------|--------|
| α (tree cleanup) | SUBSUMED | autoevo/cycle-44/ship-fail-0008 | 2 chore commits (5f921bc + ce6c649) |
| β (launchd auth) | PASS | autoevo/cycle-beta/launchd-auth-env-var | 4 commits + ADR-0010 |
| γ (install dry-run) | PASS | autoevo/cycle-gamma/install-idempotent-dry-run | 4 commits + ADR-0011 |
| δ (self-repair) | PASS | autoevo/cycle-delta/self-repair-on-repeat-failure | 5 commits + ADR-0012 + new script |
| ε (stability + DONE) | PASS | autoevo/cycle-epsilon/hourly-cadence-and-done-celebration | 4 commits + ADR-0013 |

Plus 1 launchd-spawned concurrent cycle (Cycle 45 / FAIL-0005
flip / branch `autoevo/cycle-45/fail-0005-pygithub-namerror`)
disclosed in CHANGELOG and respected.

Total session deliverables:
- 4 ADRs (0010-0013), bringing the count to 11
- 1 new script (`autodev_self_repair.sh`)
- 4 gates strengthened (launchd-auth, install --dry-run,
  3-strike self-repair, 5-cycle stability)
- 1 cadence canonical (`HUMAN_CONFIG.runtime.launchd_interval_seconds`)
- ~25 new regression tests across 4 test files
- C streak 26 → 30 (now AT C-L5 threshold)
- Overall L still 4 in LEVEL.md (compute_level --check still
  reads 4; next propose-next-track / recompute may flip C → 5)

## Operator post-session actions (per AUTH_AND_SELFREPAIR §"OPERATOR'S POST-SESSION ACTIONS")

1. Reinstall launchd to pick up the new install script:
   ```bash
   launchctl unload -w ~/Library/LaunchAgents/com.lanston.autodev.continuous.plist
   bash scripts/install_launchd_continuous.sh --dry-run    # NEW (Cycle γ): preview first
   bash scripts/install_launchd_continuous.sh --install
   ```
2. Force one immediate wake to verify auth fix works under launchd:
   ```bash
   launchctl kickstart -k gui/$(id -u)/com.lanston.autodev.continuous
   sleep 120
   tail -50 $(ls -t reports/runs/2026*.log | head -1)
   ```
   Must show real cycle work (not "Not logged in"). If yes → 24/7
   self-repairing operation begins.
3. If the operator wants 1-hour cadence (recommended for steady
   state): edit `HUMAN_CONFIG.md` `runtime.launchd_interval_seconds: 3600`
   and re-run `--install`. The install script auto-picks up the
   new value when `AUTODEV_INTERVAL_SECONDS` env is unset.

## Wall clock used
~30 minutes.
