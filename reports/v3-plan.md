# V3 plan

## Verified on-disk patches (Cowork applied between V1 and V3)

1. **`orchestrator/github_client.py`** — `latest_workflow_run_status` now wraps
   `_gh().get_workflow_runs(branch=branch)` access in `try/except` so PyGithub's
   `IndexError` (or any other transient API hiccup) returns `None` instead of
   propagating. Comment block at the patch site explicitly references V1 freeze.
2. **`orchestrator/db.py`** — `record_run` now has two guards:
   - **Fix 1 (line 128):** when `in_tokens == 0 AND out_tokens == 0`, force
     `cost = 0.0`. Kills the OAuth phantom-cost source.
   - **Fix 2 (line 137):** before INSERT, check for existing row with same
     `(issue_id, role, started_at)`. Drops the duplicate write — fixes the
     `$0.19 × 6` family of artifacts.
3. **`orchestrator/git_proxy.py`** — `mirror_to_github` now falls back to
   pushing from the per-issue worktree when the bare repo doesn't exist
   (line 169). Used to silently `return` on missing bare → empty shadow
   branches on GitHub (V1 #11 symptom).

All three patches are present at the file paths I checked; the bash greps in
this report's preamble succeeded.

## Two supervisor defects I'll fix in this session (TDD)

### Defect #2 — `SELECT_NEW` short-circuits when local backlog is empty

**Symptom from V1**: iters 2–8 spawned zero runner containers and ran zero
roles; the supervisor logged `"no work in backlog"` while issues #11/#12/#13
sat in GitHub waiting to be advanced.

**Root cause**: `autodev/supervisor.py:_execute_decision` `SELECT_NEW` branch
calls `BacklogManager.next_unblocked()`; if that returns `None`, the function
returns success with `"no work in backlog"`, never invoking the inner engine
— even when the inner engine's SQLite `tasks` table has rows in
`("queued","coding","ci_running","reviewing")` waiting to be advanced.

**Approach**:
1. Add a helper `_inner_engine_has_pending_work()` that queries `db.list_tasks_by_status`
   for each of the four active statuses and returns True if any row exists.
2. In the `SELECT_NEW` path, if `backlog.next_unblocked()` is None **but** the
   inner engine has pending work, build a synthetic `BacklogTask("TASK-INNER-<ts>", ...)`
   and continue through `_run_inner_engine` as if it were a real task.
3. If neither backlog NOR inner-engine has work, original early return stands.
4. Regression test: monkey-patch `BacklogManager.next_unblocked` to return None,
   seed inner DB with a queued task row, assert `_run_inner_engine` was called.

### Defect #3 — Stale `state.blocked` after successful cycle

**Symptom from V1**: every successive `cycle.ok` in `reports/session-log.md`
still showed `state.blocked=True, blocker_reason="inner engine exit 4"` —
the grader's criterion 9 read the stale flag and reported FAIL.

**Root cause**: `_run_inner_engine` sets `state["blocked"]=True` and
`state["blocker_reason"]=...` on failure, but the success branch never clears
either. They persist forever.

**Approach**:
1. On `result.success` (or `result.exit_code in (0, 2)`), explicitly clear:
   - `state["blocked"] = False`
   - `state["blocker_reason"] = None`
   - `state["repair_attempts_for_current_task"] = 0`
2. Regression test: pre-populate state with `blocked=True, blocker_reason="exit 4"`,
   mock `engine.run_task` to return success, assert all three fields are reset
   after `run_once()`.

## Three test issues for V3 (same as V1, with V1's stuck rows cleaned first)

- **Issue A — `chunks(items, n)` utility**: feature add to `src/utils.py`,
  ≤8 lines impl, tests covering 5 spec cases + 1 extra, strict TDD ordering.
- **Issue B — `reverse()` edge tests**: tests-only PR; must NOT modify
  `src/utils.py` or existing tests; cover unicode, emoji, mixed-script,
  single-char, whitespace.
- **Issue C — `safe_int(s, default=0)` utility**: feature add, ≤10 lines impl,
  tests covering 6 spec cases + 1 extra.

V1's #11/#12/#13 will be closed on GitHub and their DB rows dropped (Phase 5)
before V3 creates fresh issues with new numbers.

## Time budget

- Phase 0: done (5 min)
- Phase 1–2 (TDD fixes): 15–25 min
- Phase 3 (sanity + commit): 5 min
- Phase 4 (rebuild image): 5 min (cached)
- Phase 5 (cleanup V1): 3 min
- Phase 6 (baseline + issues): 5 min
- Phase 7 (3 cycles): up to 90 min hard cap
- Phase 8 (grade + verdict): 5 min

Total worst case: ~140 min. Phase 7 dominates and is hard-capped.
