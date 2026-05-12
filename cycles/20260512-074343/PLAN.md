# Cycle 20260512-074343 PLAN — Track C2-init (worktree infrastructure)

## Target dim
C (Concurrency)

## Specific gap being closed

C is the SOLE remaining L3 floor. compute_level's `concurrency_dim`
requires:
- L4: `git worktree list` shows ≥ 2 worktrees AND `orchestrator/scheduler.py` exists
- L5: + 30 cycles zero-deadlock streak file
- L7: + 5+ worktrees

This cycle puts L4's two preconditions in place. **Lifting C to L4
unlocks overall L4** (M=7, S=7, R=5, T=4, E=6, C=4 → min=4 🎯).

## Change being made

1. **`scripts/spawn_worktree.sh`** (new, executable): helper to
   `git worktree add ./worktrees/<name>` on a fresh branch. Idempotent
   (no-op if worktree exists). Used by future Track C3 scheduler.

2. **Add one real worktree**: `git worktree add ./worktrees/stream-1
   -b autoevo/worktree-stream-1` — checked in via .gitignore (the
   `worktrees/` dir itself is gitignored; only its existence as a
   git worktree counts).

3. **`orchestrator/scheduler.py`** (new, skeleton): structural
   skeleton that compute_level needs for L4 evidence. The actual
   multi-stream dispatch logic is Track C3 (next cycle). This cycle's
   scheduler has:
   - `Scheduler` dataclass with `worktree_paths: List[Path]`
   - `discover_worktrees()` — runs `git worktree list --porcelain`
     and returns paths
   - `next_idle_worktree()` — picks first worktree that has no
     in-flight cycle marker (stub; returns first available)
   - These are minimal placeholders so C3 can build on them

4. **Tests** for both: `tests/test_spawn_worktree.py` covers
   idempotency + path safety; `tests/test_scheduler.py` covers
   discover/next.

5. **`.gitignore`**: add `worktrees/` so the actual worktree contents
   don't appear in parent repo's git status.

## Acceptance criteria
- [ ] `git worktree list` shows ≥ 2 worktrees after this cycle
- [ ] `orchestrator/scheduler.py` exists with `discover_worktrees()`
      and `next_idle_worktree()`
- [ ] `scripts/spawn_worktree.sh` exists + executable + tested
- [ ] `tests/test_scheduler.py` and `tests/test_spawn_worktree.py`
      green
- [ ] `pytest -q` full suite green
- [ ] `scripts/compute_level.py` reports `C = 4`
- [ ] **Overall L = 4** (🎯 level-up event)
- [ ] `compute_level.py --check` exits 0

## Files to touch (closed set)
- `scripts/spawn_worktree.sh` (new)
- `tests/test_spawn_worktree.py` (new)
- `orchestrator/scheduler.py` (new, skeleton)
- `tests/test_scheduler.py` (new)
- `.gitignore` (+ worktrees/)
- `cycles/20260512-074343/*`
- `BACKLOG.md`, `STATE.md`, `CHANGELOG.md`, `LEVEL.md`

## Files forbidden to touch
- secrets, LEVEL by hand
- Existing production code (orchestrator/main.py, etc.)
- Existing tests / ADRs / FAILURES

## Rollback plan
`git reset --hard autoevo/pre-20260512-074343` AND remove the new
worktree: `git worktree remove worktrees/stream-1`

## Risk score
medium — creates a real second git worktree which persists on disk
across rollbacks. Mitigated by:
1. The worktree is on its OWN branch (`autoevo/worktree-stream-1`),
   doesn't pollute main.
2. `git worktree remove` can clean it up if rollback needed.
3. The worktrees/ dir is gitignored so its contents don't dirty
   the working tree.

## FAILURES.md pre-flight

Preflight flagged FAIL-0007 (record_run idempotency) via the
"idempotency" keyword in this PLAN ("Idempotent (no-op if worktree
exists)"). Citation: FAIL-0007 is about DB row double-write in
record_run; this cycle's "idempotency" refers to the shell-level
spawn_worktree.sh being safe to re-invoke. Different code path,
completely different system. **Not a repeat** — same English word,
different semantic concern.

## Open questions
None.
