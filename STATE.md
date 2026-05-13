# STATE.md — current L7 supervisor state

```yaml
current_branch: autoevo/cycle-25/continuous-cycle-script
last_cycle_id: 20260513-050612
last_cycle_result: PASS
last_green_commit: pending-commit
last_levelup: 20260513-050048      # E 6→7. No level move this cycle.
overall_level: 4                     # C is the SOLE remaining floor
dim_levels:
  M: 7
  S: 7
  R: 7
  C: 4
  T: 7
  E: 7
session_mission:
  source: AUTODEV_L7_CONTINUOUS_RUN.md
  phase_a: 3/3 COMPLETE (T6 + T7 + E7)
  phase_b: 1/5 (continuous wake script done; next: cycle prompt)
  phase_c: 0/2
  phase_d: pending
concurrency:
  worktree_count: 2
  zero_deadlock_streak: 6
  streak_target_for_L5: 30
  cycles_to_C_L5: 24
launchd_infra:
  wake_script: scripts/autodev_continuous_cycle.sh (Cycle 25)
  prompt_file: scripts/autodev_cycle_prompt.md (Cycle 26, next)
  installer:   scripts/install_launchd_autodev.sh (Cycle 27)
  dashboard:   scripts/autodev_status_dashboard.sh (Cycle 28)
  foreground_smoke: Cycle 29
  not_installed_yet: TRUE — operator runs install ONCE after Phase B done
```

## Progress (26 cycles)

Phase A complete. Phase B 1/5 done. C streak at 6/30.

## Next-cycle target

**Phase B Cycle 26**: `scripts/autodev_cycle_prompt.md` — the prompt
fed to `claude -p` on each wake. Self-contained, runs ONE cycle,
exits.

## Cycle 25 verification snapshot

- pytest: 385 passed, 2 skipped, 0 failed (15 new wake-script tests)
- compute_level: no dim move (E temporarily dropped during --check
  before proposal artifact was written; restored after running
  propose_next_track --for-cycle — see Cycle 25 REPORT for the
  procedural lesson)
- compute_level --check (post-proposal): passed
- doctor: 12/0/2
- streak: 6/30 → 24 more cycles to C-L5

## Cycle 25 procedural lesson (for the wake script's prompt)

When a cycle ends:
1. RECORD must run `propose_next_track --for-cycle <id>` BEFORE
   `compute_level --check`. Otherwise the last-5-cycles window
   transiently shows only 4/5 cycles with proposal artifacts and
   E temporarily regresses from 7 to 4, tripping --check as a false
   alarm. The fix is procedural: always run propose first.

   This is encoded in Cycle 26's autodev_cycle_prompt.md as a
   "RECORD step ordering" rule.
