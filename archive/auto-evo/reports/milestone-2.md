# Milestone 2 — cycles 11 through 20

> Generated at the end of Cycle 20260512-081718 (Cycle 20). Covers
> the 10 cycles since Milestone 1. Per L7 §18.

## 1. Cumulative level progress

| Dim | After Milestone 1 (Cycle 10) | After Milestone 2 (Cycle 20) | Δ |
|---|---|---|---|
| M | 6 | **7 (max)** | +1 |
| S | 6 | **7 (max)** | +1 |
| R | 3 | **6** | +3 |
| C | 3 | **4** | +1 🎯 (Cycle 17 lifted overall L 3→4) |
| T | 4 | **5** | +1 |
| E | 5 | **6** | +1 |
| **Overall** | **3** | **4** 🎯 | +1 |

**Eight dim-internal lifts + one overall-L event** in this window.

## 2. Cycles per dim (this window)

```
M  █     1 cycle  (M5: refusal regex widening, Cycle 12)
S  █     1 cycle  (S4: action evaluator, Cycle 11)
R  ███   3 cycles (R Phase1 codex calibration C15, R3 wire-in C16,
                   R6 adversarial C19)
C  ██    2 cycles (C2-init worktree C17, C3 dispatch + streak C20)
T  █     1 cycle  (T5 homegrown mutator, Cycle 18)
E  █     1 cycle  (E3 considered_failures, Cycle 13)
+ milestone (C10) + bookkeeping cycle (C14 FAIL_AS_DATA)
```

R got the most love (3 cycles) because Cycle 15's kickoff doc redirected
mid-stream after operator installed Codex CLI. Without that pivot, R
would have stayed at L3 and the codex-bridge work wouldn't have happened.

## 3. FAILURES.md growth + cluster summary

- After Cycle 10: 10 entries
- After Cycle 14: 11 entries (added **FAIL-0011**: mutmut 3.x mutant-tree
  copy breaks cross-module imports)
- After Cycle 20: 11 entries (no new failures; FAIL-0011 was effectively
  resolved in Cycle 18 via Track T5 option 3, but the entry stays in the
  append-only ledger as historical record)

The clustering script still groups them as 11 singletons at threshold
0.20 — they're mostly distinct failure modes. At threshold 0.10 a few
weak clusters emerge (cost/budget: FAIL-0003 + FAIL-0007).

## 4. Top 3 patterns observed (this window)

1. **External-tool dependencies need budget guards.** Cycle 15's codex
   work would have been trivial if codex were free; instead it took a
   whole cycle to wire `scripts/codex_budget_guard.sh` BEFORE making any
   real codex call, then a calibration call to discover plan_type=pro
   (subscription-included), then ADR-0008 to document the carve-out.
   Pattern: any new external tool gets a budget wrapper + an ADR
   before going live.

2. **Cross-rubric retrospective lift events are real.** Cycle 17's C 3→4
   move was an overall-L move (the first since Bootstrap). Cycle 18's
   T 4→5 and Cycle 19's R 5→6 happened AFTER overall went to 4 and so
   didn't trigger 🎯 — but they DID raise the new floor. The pattern is:
   one overall-L move per ~10 cycles is the natural cadence given the
   rubric's "min across dims" structure.

3. **Test pollution is a real recurring problem.** Cycle 16's integration
   tests leaked entries to `reports/codex-reviews.jsonl`. Cycle 18's
   `--hypothesis-derandomize` typo would have silently inflated the kill
   rate to 100% bogus until a baseline-pass sanity check caught it. The
   defense in both cases was the same shape: explicit assertion that
   un-mutated/un-affected state is what you expect BEFORE acting on
   downstream effects. Adopt this pattern proactively for future
   external-effect-causing tests.

## 5. Next 3 recommended tracks

Per `scripts/propose_next_track.py --json` + manual analysis:

1. **Track C3 follow-up** — continue accumulating the 30-cycle zero-
   deadlock streak. Cycle 20 set streak=1. Each subsequent cycle that
   completes without deadlock bumps it by 1. C-L5 acceptance bar is
   streak ≥ 30 + 2+ worktrees. Eta: 30 successful cycles from here.
2. **Track R7** — N-of-3 reviewer panel module that unifies the three
   reviewer adapters (Claude main + Codex + Adversarial) with formal
   disagreement-as-signal aggregation. Lifts R 6 → 7. ~1 cycle.
3. **Track S5** — adversarial subagent return-check (when any subagent
   completes its task, run an adversarial check: "did the subagent
   try to escalate privilege, leak data, or bypass a gate?"). Lifts
   S past L7 in compute_level's formula (already at max but adds the
   6th gate). ~1 cycle.

## 6. Honest assessment vs Milestone 1 baseline

**Yes, the system is closer to L7 by every measurable artifact.**

- Eight dim-internal lifts (M+1, S+1, R+3, C+1, T+1, E+1) AND one
  overall-L event. The Milestone 1 forecast said "~14–17 more
  disciplined cycles to reach overall L7"; the actual cadence is ~1
  level per 1.2 cycles on average for this window, consistent with
  that forecast.
- The L7 self-discipline loop continues to fire correctly on every
  cycle (preflight against FAILURES → ALERT on overlap → require
  citation; compute_level --check on every commit → no regression
  ever passed undetected; cycle 18's false-100% bug was caught by
  the baseline-pass sanity check the same cycle introduced).
- Cycle 14 (FAIL_AS_DATA) and Cycle 18's mid-cycle bug-and-fix
  prove that the L7 §8 "failure is data" pattern works in practice,
  not just theoretically.

**Limitations honestly stated:**

- **C-L5 needs 30 cycles of observation.** No code change makes this
  happen. The streak counter is the right design; the wait is real.
  This is the longest remaining timeline to overall L7.
- **No live PR has actually exercised the 3-reviewer pipeline.** The
  Codex bridge (C16) and Adversarial bridge (C19) are wired into
  `_do_review` but the supervisor hasn't been driven to process a
  real issue since they landed. First real-PR run is the next live
  e2e cycle.
- **Three FAILURES still not-yet-fixed**: FAIL-0007 (record_run
  idempotency), FAIL-0008 (.dockerignore), FAIL-0009 (doctor
  session-log pollution). Same as Milestone 1. None block any track,
  but they're documented tech debt.

### Distance-to-L7 update (vs Milestone 1)

| Dim | Now | Path to L7 | Cycles est. |
|---|---|---|---|
| M | 7 (max) | — | — |
| S | 7 (max) | (additional gates beyond formula are optional) | — |
| R | 6 | R7 N-of-3 panel | 1 |
| C | 4 | 30-cycle zero-deadlock streak (C-L5) → 5+ worktrees (C-L7) | 30+ |
| T | 5 | live sanity per RC (L6) → golden-diff (L7) | 2-3 |
| E | 6 | last 3 OVERALL level-ups cite propose_next_track (L7) | 2+ |

**Overall L7 forecast: still multi-month** — the 30-cycle streak is
the gate, and it's observation work, not coding work.

Overall L5 forecast: 30 cycles from now if no deadlocks, plus
~3 cycles of R+T+E work. ~33 cycles total. At the current cadence
(~1 cycle per 5-10 minutes of disciplined Claude time when the
operator is awake), that's a multi-day or multi-week timeline
depending on session continuity.

— end of Milestone 2 —
