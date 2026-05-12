# FAILURES.md — indexed failure ledger

> Append-only. Every PLAN must grep this file for keywords matching its
> approach. If a hit is found, cite why this time is different OR pick a
> different approach. See §5 of `AUTODEV_L7_MASTER_PROMPT.md`.

## FAIL-0001: Reviewer rejected TDD-compliant PR for trailing edge-case test

**Date**: 2026-05-11 (V3 E2E test, issue #14 "chunks")

**Symptom**: Issue #14 produced a clean implementation of `chunks()` with
the commit sequence `test → feat → test`. The trailing `test:` commit added
an edge-case test for empty input AFTER the implementation. Reviewer rejected
the PR citing "TDD ordering violation". Task stuck at `human_review` waiting
for a human override.

**Root cause**: `orchestrator/main.py:_check_tdd_invariant` enforced a strict
prefix-only gate — every commit on the branch had to be `test:*` before any
`feat:*` could appear. The reviewer role prompt mirrored the strict policy.
Both rejected legitimate TDD behaviour where edge cases are discovered and
covered after the main impl lands.

**Failed fix attempts**: None (V3 shipped the broken gate; the gate's
behaviour was as-designed, the design was wrong).

**Working fix**: V4 commit `110e7bd` — rewrote `_check_tdd_invariant` to
detect **intent** rather than strict ordering. Pass condition: at least one
`test:` / `tests:` / `spec:` / `specs:` / `coverage:` commit before at least
one `feat:` / `fix:` / `impl:` / `implement:` / `refactor:` commit, AND the
diff has substantive `tests/**` content. Updated both role prompts.

**Regression test**:
- `tests/test_v4_hardening.py::test_tdd_intent_accepts_edge_case_test_after_impl`
- `tests/test_v4_e2e_replay.py::test_v4_scenario_14_edge_case_test_after_impl_passes_tdd_gate`

**Keywords**: tdd, tdd-ordering, reviewer, false-reject, edge-case-test,
trailing-test, commit-prefix-gate, _check_tdd_invariant

**Linked ADR**: docs/adr/0003-tdd-intent-not-strict-order.md

---

## FAIL-0002: Impossible spec looped forever at `coding` state

**Date**: 2026-05-11 (V3 E2E test, issue #15 "reverse")

**Symptom**: Issue #15 asked for tests of `reverse()` in `src/utils.py`
while also stating "Do not modify `src/utils.py`". `reverse()` did not
exist in `src/utils.py`. Coder correctly returned BLOCKED. Orchestrator
re-dispatched Coder. Coder returned BLOCKED. Repeat indefinitely. Task
state never left `coding`. Cost accumulated across N retries before the
supervisor's HOLD-after-N retry rule fired.

**Root cause**: The orchestrator state machine had no concept of "this
issue is impossible under its own constraints". Every Coder BLOCKED was
treated as a transient failure to retry. No terminal state existed for
"impossible spec".

**Failed fix attempts**:
- (V3 partial) Add a max-retries counter that transitions to `failed`
  after N. Worked for the supervisor's outer recovery but left the inner
  engine state at `coding` and the issue at "in progress" on GitHub.
- (Considered, rejected) Have Coder write the impossibility back to the
  issue body. Coder cannot edit the issue (no write token in the runner
  container by design).

**Working fix**: V4 commit `110e7bd` — new `orchestrator/preflight.py`
module with `preflight_issue(title, body, repo_root) -> PreflightResult`.
Detects the narrow pattern: symbol referenced as required + symbol absent
from on-disk file + that file forbidden from modification. Wired into
`_do_planning` as the first step before Planner is invoked; on impossible
result, mark task `failed` (terminal) and skip Planner entirely.

**Regression test**:
- `tests/test_v4_hardening.py::test_preflight_impossible_spec_reverse_absent`
- `tests/test_v4_e2e_replay.py::test_v4_scenario_15_impossible_spec_terminalises_at_preflight`

**Keywords**: preflight, impossible-spec, blocked-impossible, coding-loop,
infinite-retry, reverse, _do_planning, symbol-absent, forbidden-file

**Linked ADR**: docs/adr/0002-preflight-impossible-spec.md

---

## FAIL-0003: Guardian false-pause on phantom subscription cost

**Date**: 2026-05-11 (V3 E2E test, issue #16 "Guardian phantom-cost spike")

**Symptom**: User was on Claude subscription (`sk-ant-oat01-...`), so
per-call cost should always be $0. But Guardian queried `runs.cost_usd`
directly from SQLite, and CLI was emitting non-zero estimated USD figures
into that column. Estimates accumulated across roles, crossed the 2× moving
average threshold, false-paused the supervisor on a clean run. `state/PAUSED`
got written; the operator had to manually `rm state/PAUSED` to resume.

**Root cause**: Cost was masked only in `metrics.json` (the file Guardian
was *supposed* to read), but Guardian's actual code path queried
`runs.cost_usd` from the DB. The mask was in the wrong place — at read time
for one consumer, instead of write time at the source. Any DB-direct reader
(Guardian audit, circuit-breaker, ad-hoc query) saw the raw estimates.

**Failed fix attempts**:
- (V3 partial) Update Guardian to read `metrics.json` instead. Fragile —
  Guardian had multiple query paths. Some still hit the DB directly.
- (V3 partial) Set CLI flag to suppress cost output. CLI ignored the flag
  under subscription mode.

**Working fix**: V4 commit `110e7bd` — new `orchestrator/billable.py` with
`to_billable_cost()`; called in `orchestrator/db.py:record_run` BEFORE the
SQL INSERT. The DB itself stores the billable figure. Every reader agrees
by construction. API mode (`sk-ant-api03-`) is unaffected.

**Regression test**:
- `tests/test_v4_hardening.py::test_db_record_run_zeros_cost_under_subscription`
- `tests/test_v4_hardening.py::test_billable_load_budget_metrics_subscription`
- `tests/test_v4_e2e_replay.py::test_v4_scenario_16_guardian_does_not_false_pause_under_subscription`

**Keywords**: guardian, false-pause, phantom-cost, subscription, oat01,
billable, cost-mask, record_run, metrics.json, daily-cost-spike,
2x-moving-average

**Linked ADR**: docs/adr/0001-billable-cost-at-insert.md

---

## FAIL-0004: `_inner_engine_has_pending_work` crashed on macOS `/state` read-only

**Date**: 2026-05-11 (V3 E2E test, environmental)

**Symptom**: `autodev/supervisor.py:_inner_engine_has_pending_work` raised
`OSError: [Errno 30] Read-only file system: '/state'` when computing the
default state DB path on macOS host (no Docker). Worse, the function
silently swallowed any non-OSError exception and returned `False`, so the
supervisor mis-detected "no pending work" and skipped the inner engine
even when work existed.

**Root cause**: Pre-V4 code assumed `STATE_DIR` defaulted to `/state` (the
Docker container path). macOS root filesystem is sealed and read-only.
Plus, the catch-all `except` masked DB-corruption / permission errors.

**Failed fix attempts**: None at root level. The function was originally
written for the Docker case and never updated for host-side runs.

**Working fix**: V4 commit `110e7bd` — new `_resolve_state_db_path()` with
explicit env-var precedence (`AUTODEV_STATE_DB` > `STATE_DIR` >
project-local `<repo>/state/orchestrator.db`). Never falls back to `/state`.
The function logs DB errors via `logging.getLogger("supervisor.pending_work").warning(...)`
instead of silently returning `False`.

**Regression test**:
- `tests/test_v4_hardening.py::test_resolve_state_db_path_falls_back_to_project_local`
- `tests/test_v4_hardening.py::test_pending_work_honors_state_dir_env`
- `tests/test_v4_hardening.py::test_pending_work_autodev_state_db_overrides_state_dir`
- `tests/test_v4_hardening.py::test_pending_work_returns_false_when_db_missing`

**Keywords**: state-dir, autodev_state_db, supervisor, pending-work,
read-only-filesystem, macos, /state, _resolve_state_db_path,
silent-false, env-var-precedence

**Linked ADR**: docs/adr/0004-state-dir-resolution.md
