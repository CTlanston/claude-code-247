# Cycle 20260512-081718 PLAN — Track C3 (dispatch_next) + milestone-2

## Target dimension
C (Concurrency) — infrastructure cycle. C-L5 needs a 30-cycle zero-
deadlock streak; this cycle puts the streak counter + dispatch picker
in place. C remains at L4 after this cycle (streak count = 0 → 1).

Per L7 §18 this is the 10th cycle since milestone-1 (cycles 11-20),
so `reports/milestone-2.md` is also written this cycle as a required
bookkeeping artifact.

## Specific gap being closed

`compute_level.py:concurrency_dim` C-L5 check:
```python
if n_worktrees >= 2 and streak >= 30:
    return DimResult("C", level=5, ...)
```

Where streak is read from `reports/zero-deadlock-streak.txt`. Today
that file doesn't exist (streak=0). This cycle creates the streak
file and the helpers that subsequent cycles will use to bump it.

The kickoff Phase 2 row 4 says: "Track C3 — `scheduler.py` dispatching
across worktrees; per-worktree STATE.md". Full multi-stream dispatch
is multi-cycle work. This cycle's scope: the picker logic
(`Scheduler.dispatch_next()`) + the streak-counter scaffolding +
end-to-end test on a stub task list.

## Change being made

1. **`orchestrator/scheduler.py` extensions** (existing module from
   Cycle 17 C2-init):
   - `Task` dataclass (`id`, `priority`, `blocked`, `payload`)
   - `Scheduler.tasks: List[Task]` (queue)
   - `dispatch_next() -> Optional[Tuple[Worktree, Task]]`:
     * Refresh worktree list
     * Pick lowest-priority unblocked task whose `id` isn't already
       in an in-flight marker
     * Pick idle worktree via existing `next_idle_worktree()`
     * Returns the pair, or None if nothing dispatchable
   - `record_cycle_success(cycle_id, *, deadlock=False)`:
     * Append to `reports/cycle-history.jsonl` with success/deadlock flag
     * If `deadlock=False`: bump
       `reports/zero-deadlock-streak.txt` by 1
     * If `deadlock=True`: reset streak to 0 + log to FAILURES
   - `current_zero_deadlock_streak() -> int`: read+parse the file

2. **`tests/test_scheduler.py` extensions**: ≥ 8 new tests for the
   above (existing 11 tests stay green):
   - `dispatch_next` picks lowest-priority + idle worktree
   - Blocked tasks skipped
   - In-flight tasks skipped
   - All-busy worktrees → None
   - Empty task list → None
   - `record_cycle_success(deadlock=False)` bumps streak
   - `record_cycle_success(deadlock=True)` resets streak
   - `current_zero_deadlock_streak` handles missing file (returns 0)

3. **`reports/zero-deadlock-streak.txt`** (new): seed with `1`. This
   cycle's successful completion (no deadlock observed) counts as
   the first entry in the streak. The compute_level evidence string
   will show "Need 30-cycle ... (have 1)" → still L4, but the counter
   is now real.

4. **`reports/milestone-2.md`** (new): per L7 §18. Covers cycles
   11-20 (since milestone-1):
   - Cumulative level progress
   - Cycles per dim
   - FAILURES growth (was 11, still 11 — FAIL-0011 is resolved but
     stays in ledger)
   - Top 3 patterns observed
   - Next 3 tracks
   - Honest assessment vs cycle-10 baseline

## Acceptance criteria
- [ ] `orchestrator/scheduler.py` gains `Task`, `dispatch_next`,
      `record_cycle_success`, `current_zero_deadlock_streak`
- [ ] `tests/test_scheduler.py` has ≥ 19 tests total (was 11, +8),
      all green
- [ ] `reports/zero-deadlock-streak.txt` exists with `1`
- [ ] `reports/milestone-2.md` exists with all 6 §18 sections
- [ ] `pytest -q` full suite green
- [ ] `compute_level.py` reports C-dim with streak=1 evidence
- [ ] `compute_level --check` exits 0
- [ ] CHANGELOG, STATE, BACKLOG, LEVEL all updated

## Files to touch (closed set)
- `orchestrator/scheduler.py` (extend)
- `tests/test_scheduler.py` (extend)
- `reports/zero-deadlock-streak.txt` (new)
- `reports/cycle-history.jsonl` (new, may be empty initially)
- `reports/milestone-2.md` (new)
- `cycles/20260512-081718/*`
- `BACKLOG.md`, `STATE.md`, `CHANGELOG.md`, `LEVEL.md`

## Files forbidden to touch
- secrets, LEVEL by hand
- `orchestrator/main.py` (production scheduler integration is Track
  C4, not this cycle — keep scope tight)
- Other production modules
- Existing tests (only `test_scheduler.py` is extended)

## Rollback plan
`git reset --hard autoevo/pre-20260512-081718`

## Risk score
low — additive code in scheduler + new artifact files. No production
flow changes. main.py is not touched.

## FAILURES.md pre-flight result
Will run after writing.

## Open questions / blockers
None. Full multi-stream live dispatch is C4+ scope.
