# STATE.md — current L7 supervisor state

```yaml
current_branch: autoevo/cycle-27/launchd-installer
last_cycle_id: 20260513-051843
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
  phase_b: 3/5 (wake script + cycle prompt + installer done;
                next: status dashboard, then foreground smoke)
  phase_c: 0/2
  phase_d: pending
concurrency:
  worktree_count: 2
  zero_deadlock_streak: 8
  streak_target_for_L5: 30
  cycles_to_C_L5: 22
launchd_infra:
  wake_script:        scripts/autodev_continuous_cycle.sh        (Cycle 25 ✓)
  prompt_file:        scripts/autodev_cycle_prompt.md            (Cycle 26 ✓)
  installer (L7):     scripts/install_launchd_continuous.sh      (Cycle 27 ✓)
  installer (v3):     scripts/install_launchd_autodev.sh         (pre-existing, untouched)
  dashboard:          scripts/autodev_status_dashboard.sh        (Cycle 28, next)
  foreground_smoke:   Cycle 29
  not_installed_yet:  TRUE — operator runs install ONCE after Phase B done
launchd_labels:
  L7_continuous: com.lanston.autodev.continuous   # this session's deliverable
  v3_supervisor: com.autodev.supervisor           # pre-existing v3 agent
```

## Progress (28 cycles)

Phase A complete. Phase B 3/5 done. C streak at 8/30.

## Next-cycle target

**Phase B Cycle 28**: `scripts/autodev_status_dashboard.sh` — read-only
ops command. Shows overall L, dim table, C streak, last 5 cycles,
stop conditions, launchctl status for both L7 and v3 agents.

## Cycle 27 verification snapshot

- pytest: 438 passed, 2 skipped, 0 failed (+26 installer tests this cycle)
- propose_next_track --for-cycle 20260513-051843 → proposal written FIRST
- compute_level --check (post-proposal): passed (Overall L=4 stable)
- doctor: 12/0/2
- streak: 8/30 → 22 more disciplined cycles needed for C-L5

## Naming deviation from kickoff doc

The kickoff doc says "Cycle 27 — Build `scripts/install_launchd_autodev.sh`",
but a pre-existing v3 file already lives at that path (LABEL
`com.autodev.supervisor`, runs `autodev_supervisor.sh`). To avoid
clobbering live v3 infrastructure, the L7 installer ships at
`scripts/install_launchd_continuous.sh` (LABEL
`com.lanston.autodev.continuous`, runs `autodev_continuous_cycle.sh`).
The two agents are independent and can coexist. Cycle 30's
handoff doc will cite the correct path.
