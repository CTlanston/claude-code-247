# STATE.md — current L7 supervisor state

```yaml
current_branch: autoevo/cycle-15/codex-calibration
last_cycle_id: 20260512-072615
last_cycle_result: PASS
last_green_commit: pending-commit
last_levelup: 20260512-072615      # R went 3→4
overall_level: 3                     # locked by C at L3 now (R lifted out of the floor)
dim_levels:
  M: 7   # max
  S: 7   # max
  R: 4   # bridge infra ready (budget guard + tests + CLI on PATH)
  C: 3   # the SOLE remaining floor
  T: 4   # mutmut blocked (FAIL-0011); T5-workaround needed
  E: 6
open_blockers:
  - FAIL-0011: mutmut 3.x cross-module import collection failure
  - (informational) operator should confirm Codex billing model
    on OpenAI dashboard — see reports/codex-cost-calibration.md
in_flight_worktrees:
  - main
updated_at: 2026-05-12T07:35:00Z
codex:
  enabled: true
  binary_on_path: true
  guard_present: true
  daily_cap_tokens: 200000
  per_call_cap_tokens: 60000
  spend_today_tokens: 130162   # the calibration call
  plan_type_observed: pro      # subscription, NOT paid API (likely)
  ADR: docs/adr/0008-codex-cli-budgeted-review.md
```

## Progress (16 cycles: Bootstrap + 15)

Ten dim-internal lifts. M=L7 max, S=L7 max, R=L4 (NEW), T=L4,
E=L6, C=L3 (sole floor).

**Overall L still 3** — C is the only remaining floor. Lifting C
requires worktree infrastructure (multi-cycle), so the path to overall
L4 is now strictly through C.

## Next-cycle target

Per `propose_next_track.py` + Phase 2 of kickoff:

1. **Track R3** (P0) — wire codex_reviewer into orchestrator/main.py
   reviewer step. Single cycle. Lifts R 4 → 5. Each subsequent PR
   review provides real-world spend data (calibration data set N=1
   today; this lifts N to 5+ across the next cycles).
2. **Track C2** (P0/P1) — git worktree infrastructure.
3. **Track T5-workaround** (P1) — homegrown mutator for billable.py.

## Cycle 15 verification snapshot

- pytest: 258 passed, 1 skipped, 0 failed
- compute_level: R=L4 (infra ready); all other dims stable
- compute_level --check: passed (R lifted, no regression)
- compute_level self-tests: 33 (added 3 R-dim L4/L5 tests)
- doctor: 11/0/2
- codex live call: 1 entry in reports/codex-spend.jsonl
  (130,162 tokens, 57s, exit 0, plan_type=pro, verdict=approve)
- GO verdict from reports/codex-cost-calibration.md (subscription
  billing observed; operator should confirm dashboard)
