# Backlog

Ordered by priority. Format: `- [ ] TASK-NNN: short title :: details`.

Status:
- `- [ ]` queued
- `- [.]` in progress (also tracked in `tasks/current.md`)
- `- [x]` done (also archived in `tasks/done.md`)
- `- [!]` blocked (also tracked in `tasks/blockers.md`)

## P0

- [.] TASK-001: Smoke-test AutoDev outer loop dry-run :: Run `./scripts/autodev_doctor.sh && ./scripts/autodev_once.sh --dry-run` and capture output. No live work, just verify the supervisor and its dependencies load.

## P1

- [.] TASK-002: Wire Auto-Evo inner engine into `autodev/inner_engine.py` :: Replace the stub `InnerEngine.run_task()` with a real call to the existing `orchestrator/main.py` state machine, mapping AutoDev states → orchestrator states. Until done, live mode short-circuits to dry-run.
- [ ] TASK-003: Address the phantom-cost root fix from issue #6 :: Make `orchestrator/db.py:record_run` idempotent (UNIQUE constraint on issue_id+role+started_at). See https://github.com/CTlanston/auto-evo-playground/issues/6.

## P2

- [ ] TASK-004: Add `.dockerignore` to runner + orchestrator builds :: Excludes `state/`, `workspaces/`, `.env*`, `__pycache__/` to slim images.
- [ ] TASK-005: Promote per-role token budgets from `runner.py` to `.env` :: Currently hard-coded.
- [ ] TASK-006: Add cleanup-worktree call at `merged` state transition :: `git_proxy.cleanup_worktree()` exists but has no caller.
- [ ] TASK-007: Fix `record_run` double-write + zero-token phantom cost :: Mirrors issue #6 on GitHub.
