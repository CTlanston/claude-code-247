# STATE.md — current L7 supervisor state

```yaml
current_branch: autoevo/cycle-19/adversarial-reviewer
last_cycle_id: 20260512-081235
last_cycle_result: PASS
last_green_commit: pending-commit
last_levelup: 20260512-081235      # R went 5→6
overall_level: 4                     # C is the sole remaining floor
dim_levels:
  M: 7   # max
  S: 7   # max
  R: 6   # NEW: adversarial reviewer wired (3rd pass)
  C: 4   # sole floor
  T: 5
  E: 6
open_blockers:
  - (informational) operator should confirm Codex billing model
    on OpenAI dashboard — see reports/codex-cost-calibration.md
in_flight_worktrees:
  - main (primary at repo root)
  - worktrees/stream-1 (autoevo/worktree-stream-1)
updated_at: 2026-05-12T08:18:00Z
review_panel:
  reviewer_1_claude:      orchestrator/roles/reviewer.md (single-model)
  reviewer_2_codex:       orchestrator/codex_reviewer.py (Cycle 15-16)
  reviewer_3_adversarial: orchestrator/adversarial_reviewer.py (Cycle 19)
  panel_aggregator:       NOT YET (Track R7 → N-of-3 with escalation)
  alert_protocol:
    - Codex ≠ Claude on pass/fail → ALERT.md (codex_reviewer.disagreement_protocol)
    - Claude=APPROVE + Adversarial=REJECT → ALERT.md (asymmetric, observer-only)
  logs:
    - reports/codex-spend.jsonl       (budget audit; committed)
    - reports/codex-reviews.jsonl     (per-PR Codex log; gitignored)
    - reports/adversarial-reviews.jsonl (per-PR adversarial log; gitignored)
mutation_testing:
  sut: orchestrator/billable.py (94 lines)
  kill_rate: 1.0000 (21/21)
  determinism: stable across runs
```

## Progress (20 cycles: Bootstrap + 19)

Fourteen dim-internal lifts + one overall-L event (Cycle 17 🎯).

```
Bootstrap: M=4 S=5 R=3 C=3 T=3 E=3 → overall=3
After C17: M=7 S=7 R=5 C=4 T=4 E=6 → overall=4 🎯
After C18: M=7 S=7 R=5 C=4 T=5 E=6 → overall=4 (C is sole floor)
After C19: M=7 S=7 R=6 C=4 T=5 E=6 → overall=4 (C is still sole floor)
```

## Next-cycle target

Per propose_next_track + user directive:

1. **Track C3** (P0) — Scheduler.dispatch_next() + zero-deadlock streak.
   The only path to overall L5. Multi-cycle journey.
2. **Track R7** (P1) — N-of-3 reviewer panel module to unify the three
   reviewer adapters with formal disagreement escalation. Lifts R 6 → 7.
3. **Track E7** — wait for more overall-L moves before this can fire.

## Milestone watch

Cycle 20 will be the 10th SUCCESSFUL cycle after milestone-1 (cycles 11
through 20). Per L7 §18: write `reports/milestone-2.md` then.

## Cycle 19 verification snapshot

- pytest: 325 passed, 2 skipped, 0 failed (12 new adversarial tests)
- compute_level: R=L6 ("Adversarial Reviewer active")
- compute_level --check: passed
- doctor: 11/0/2

## How the review panel runs today

For every PR review:
1. `_do_review` runs deterministic gates (forbidden paths, TDD intent)
2. Calls Claude main reviewer via `runner.run_role("reviewer", ...)`
3. Calls `_maybe_run_codex_review` → logs codex-reviews.jsonl, ALERT
   on Claude↔Codex pass/fail disagreement
4. Calls `_maybe_run_adversarial_review` → logs adversarial-reviews.jsonl,
   ALERT on Claude=APPROVE + Adversarial=REJECT (asymmetric)
5. Claude's verdict decides what happens next; observers only escalate.
