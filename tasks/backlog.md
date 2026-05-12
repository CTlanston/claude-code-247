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
- [.] TASK-003: Address the phantom-cost root fix from issue #6 :: Make `orchestrator/db.py:record_run` idempotent (UNIQUE constraint on issue_id+role+started_at). See https://github.com/CTlanston/auto-evo-playground/issues/6.

## P2

- [.] TASK-004: Add `.dockerignore` to runner + orchestrator builds :: Excludes `state/`, `workspaces/`, `.env*`, `__pycache__/` to slim images.
- [.] TASK-005: Promote per-role token budgets from `runner.py` to `.env` :: Currently hard-coded.
- [.] TASK-006: Add cleanup-worktree call at `merged` state transition :: `git_proxy.cleanup_worktree()` exists but has no caller.
- [.] TASK-007: Fix `record_run` double-write + zero-token phantom cost :: Mirrors issue #6 on GitHub.

## TASK-E2E-1778491047 (P1)
3-cycle E2E validation. Drives the inner engine through issues #11, #12, #13.
- priority: P1
- created: 2026-05-11T09:17:27Z
- expected_outcome: each of the 3 issues reaches human_review with a clean PR

## P0

- [.] TASK-E2E-001: drive cycle 1 :: process issue #11 (chunks) to human_review
- [.] TASK-E2E-002: drive cycle 2 :: process issue #12 (reverse edges) to human_review
- [.] TASK-E2E-003: drive cycle 3 :: process issue #13 (safe_int) to human_review
- [.] TASK-E2E-004: drive cycle 4 :: extra slot for retries on any of A/B/C
- [.] TASK-E2E-005: drive cycle 5 :: extra slot
- [.] TASK-E2E-006: drive cycle 6 :: extra slot
- [.] TASK-E2E-007: drive cycle 7 :: extra slot
- [.] TASK-E2E-008: drive cycle 8 :: extra slot

## P0

- [.] TASK-V3-1778496611: V3 E2E test trigger :: 3 issues to human_review

- [ ] TASK-V3-RECOVER-1778540125-001: continue V3 :: drive remaining issues to terminal
- [ ] TASK-V3-RECOVER-1778540125-002: continue V3 :: extra slot
- [ ] TASK-V3-RECOVER-1778540125-003: continue V3 :: extra slot
- [ ] TASK-V3-RECOVER-1778540125-004: continue V3 :: extra slot
- [ ] TASK-V3-RECOVER-1778540125-005: continue V3 :: extra slot
