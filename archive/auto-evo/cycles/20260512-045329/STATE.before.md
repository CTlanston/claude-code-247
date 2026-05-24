# STATE.md — current L7 supervisor state

> Rewritten each cycle. Previous version saved to
> `cycles/<CYCLE_ID>/STATE.before.md`.

```yaml
current_branch: autoevo/cycle-3/propose-next-track
last_cycle_id: 20260512-044832
last_cycle_result: PASS
last_green_commit: 9253149
last_levelup: 20260512-044832       # E-dim moved L3 → L4
overall_level: 3                     # min across M=5, S=5, R=3, C=3, T=3, E=4
dim_levels:
  M: 5
  S: 5
  R: 3
  C: 3
  T: 3
  E: 4
open_blockers: []
in_flight_worktrees:
  - main (no extra worktrees)
updated_at: 2026-05-12T05:00:00Z
```

## Next-cycle target

Per `propose_next_track.py` (live on this repo, can be run with
`scripts/propose_next_track.py --verbose`):

**Chosen**: Track T2-property-billable (P0, dim=T, score=8.00).
T-dim is at L3 — now the floor — and the track moves it part of the
way to L4 (which needs property-based tests on ≥ 3 modules).

After T2-billable: T2-preflight (property tests on `preflight.py`) and
T2-tdd-intent (property tests on `_check_tdd_invariant`). Three module
slots = T-L4.

## Cycle-3 verification snapshot

- pytest: 160 passed, 1 skipped, 0 failed
- compute_level.py: E=L4 (propose_next_track.py exists)
- compute_level.py --check: passed (no regression; E moved up)
- propose_next_track self-tests: 13 passed
- autodev_doctor.sh: 11 passed, 0 failed, 2 warned (env)
- Smoke proposal on real repo: picks Track T2-property-billable
  (correct — T is the new floor)
