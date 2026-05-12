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

---

## FAIL-0005: PyGithub PaginatedList IndexError froze inner-engine loop for all issues

**Date**: 2026-05-11 (V3 E2E test environment, observed during dispatch
of issues #11/#12/#13)

**Symptom**: `orchestrator/github_client.py:latest_workflow_run_status`
raised `IndexError` (or a generic `GithubException`) when a shadow branch
had not yet been pushed to GitHub (or the workflow had never fired on it).
The exception propagated out of `main_oneshot`, causing the inner engine
loop to abort for ALL queued issues — not just the one being checked.
Effective behaviour: one missing workflow froze the entire dispatch queue
until the supervisor's outer-recovery retry kicked in.

**Root cause**: PyGithub's `PaginatedList` lazy-loads pages on access. An
empty list with `runs[:1]` indexing tripped IndexError. Combined with no
try/except wrapper, any transient API hiccup also bubbled up.

**Failed fix attempts**:
- (rejected) try/except IndexError only — still let `GithubException`
  through.
- (rejected) check `runs.totalCount > 0` first — PyGithub raises during
  `totalCount` resolution on some auth-permission edge cases too.

**Working fix**: pre-V4 (V3 cleanup era) commit `9df48f6`. Wrap the entire
PyGithub call site in `try / except Exception`, log a warning via the
module logger, and return `None` so callers move on to the next task.
Also probe `runs.totalCount` defensively (also try/except).

**Regression test**: not yet (the V3-era fix shipped without a unit test
because the code path needs network mocking; a future cycle can add a
`pytest-vcr`-style or `unittest.mock` test stub).

**Keywords**: pygithub, paginatedlist, indexerror, workflow-runs,
shadow-branch, dispatch-freeze, github-client, latest_workflow_run_status,
defensive-exception, transient-api

---

## FAIL-0006: Bare-remote missing → mirror_to_github silently dropped the push, leaving an empty shadow branch on GitHub

**Date**: 2026-05-11 (V3 E2E test, observed for issues #14 and #15 on
the first dispatch of each shadow branch)

**Symptom**: `orchestrator/git_proxy.py:mirror_to_github(branch)` was
called after Coder committed to the per-issue worktree. The function
walked to `WORKSPACE_ROOT/.bare` to push, found no bare repo there, and
**logged a warning + returned silently**. The shadow branch was committed
locally but never reached GitHub. Reviewer then ran against a branch that
"existed" in the GitHub UI (sometimes the API still recognised it as a
target) but contained no commits, leading to confusing diff displays and
the worktree's clean commit being effectively lost from GitHub's view.

**Root cause**: The bare-remote bootstrap step was assumed-present by
`mirror_to_github` but was actually conditional on a `setup.sh`
sub-flag. When the operator ran the inner engine on a fresh machine
without that flag, the bare remote was never created, and the silent
log-and-skip path was the wrong default — it should have failed loudly
or fallen back.

**Failed fix attempts**:
- (rejected) `setup.sh` always creates the bare remote on first run.
  Doesn't help when the user followed a different setup path.
- (rejected) Refuse to commit until bare-remote present. Too strict;
  per-issue worktrees often run before the bare remote is wanted.

**Working fix**: V3 cleanup-era commit `9df48f6`. Add a **Path B
fallback**: if `WORKSPACE_ROOT/.bare` is missing, derive the issue
number from the branch name (`shadow/issue-<N>`), locate the per-issue
worktree at `WORKSPACE_ROOT/issue-<N>/repo`, and push from there
directly. Log `[git_proxy] bare remote missing, falling back to worktree
push from <path>` so operators see the fallback firing.

**Regression test**: not yet (would need a fake-GitHub fixture; tracked
as a future Track-T candidate for the orchestrator subsystem).

**Keywords**: git_proxy, mirror_to_github, bare-remote, shadow-branch,
silent-drop, worktree-fallback, push-loss, path-b-fallback,
workspace_root, setup.sh

---

## FAIL-0007: record_run double-write created phantom-cost rows on early-exit retry

**Date**: 2026-05-10 (pre-V4 inner-engine work; tracked as TASK-007 in
tasks/backlog.md and GitHub issue #6 on the test repo)

**Symptom**: When a Coder role early-exited (e.g. with the CLI returning
non-zero before any tokens were billed) and the outer recovery loop
retried within the same supervisor cycle, the SQLite `runs` table got
two rows for the same logical run: one from the failed attempt
(zero tokens, zero cost) and one from the successful retry (real tokens,
real cost). Guardian's daily-cost aggregation double-counted the
zero-cost row, then on a third retry triple-counted, etc. Cost reports
showed phantom inflation that didn't match the CLI's own per-call totals.

**Root cause**: `orchestrator/db.py:record_run` did `INSERT INTO runs
(...)` with no UNIQUE constraint on `(issue_id, role, started_at)`. Every
call was a fresh row, even if the same logical attempt had already
recorded.

**Failed fix attempts**:
- (rejected) Hash the row contents and skip if same hash seen recently.
  Hash is fragile (timestamps drift) and can mis-deduplicate legitimate
  retries.
- (rejected) Pre-flight check "is there already a row for this
  (issue, role, started_at)" — race condition vs. the actual INSERT.

**Working fix**: planned (NOT YET SHIPPED). Make the INSERT idempotent
via either (a) `INSERT OR IGNORE` with a UNIQUE constraint on the
natural key `(issue_id, role, started_at)`, or (b) `ON CONFLICT DO
NOTHING`. The fix is small but requires a one-time `ALTER TABLE` /
`CREATE UNIQUE INDEX` migration that this codebase doesn't yet have a
framework for. **Sibling of FAIL-0003** (which addressed the cost-mask
layer but not the row-duplication layer). The V4 `to_billable_cost`
helper masks the *value*; this entry covers the *row count*.

**Regression test**: not yet (will land with the migration).

**Keywords**: record_run, idempotency, double-write, phantom-cost,
unique-constraint, issue_id, role, started_at, sqlite, alter-table,
migration, on-conflict-do-nothing

**Linked**: FAIL-0003 (sibling). When this lands, ADR-0001 should be
updated to mention the additional row-count safety net.

---

## FAIL-0008: .dockerignore missing → orchestrator/runner image bloat with state/, workspaces/, .env

**Date**: 2026-05-10 (TASK-004 in tasks/backlog.md)

**Symptom**: `docker build` for both `orchestrator/Dockerfile` and
`runner/Dockerfile` copied the entire repo context, including
`state/*.db` (live DB), `workspaces/` (per-issue clones, possibly
gigabytes), `.env` (SECRET — would leak into the image layer), and all
`__pycache__/`. Resulting images were 800MB+ and shipped credentials.

**Root cause**: No `.dockerignore` in the repo root. `Dockerfile`s did
`COPY . /workspace` blindly.

**Failed fix attempts**: none (caught early in inner-engine development).

**Working fix**: planned (NOT YET SHIPPED). Add a root `.dockerignore`
excluding `state/`, `workspaces/`, `.env*`, `__pycache__/`, `*.pyc`,
`.venv/`, `cycles/`, `reports/runs/`. Plus a regression test that
`docker build` (or, more cheaply, a `tar --list` of the build context)
excludes those paths. Filed in BACKLOG as a small standalone cycle.

**Regression test**: not yet (will land with the fix).

**Keywords**: dockerignore, image-bloat, docker-build, credentials-leak,
.env-leak, build-context, runner-image, orchestrator-image, state-leak,
workspaces-leak

---

## FAIL-0009: doctor's "modules import cleanly" check side-effect dirties reports/session-log.md every cycle

**Date**: 2026-05-12 (observed during L7 Cycle 0 and Cycle 1 of this
session)

**Symptom**: Each invocation of `./scripts/autodev_doctor.sh` runs an
import smoke test that — to verify CLI classification logic loads —
imports modules that emit 4 audit-log entries to `reports/session-log.md`
(`cli.execution classify=rate_limited`, `permission_needed`, `success`,
plus `cli.timeout classify=timeout`). The next `git status` shows
`reports/session-log.md` modified, which violates the L7 cycle-clean
precondition. Cycle 0 and Cycle 1 both committed this as an inadvertent
side effect.

**Root cause**: The CLI classification self-test is wired through the
production audit-log path. There is no in-memory or `/dev/null` sink for
import-time self-tests; everything goes through `reports/session-log.md`.

**Failed fix attempts**: none (only just observed).

**Working fix**: planned (NOT YET SHIPPED). Either (a) route the
import-time self-tests through a stub audit-log writer that doesn't
touch disk, or (b) make doctor's smoke test a no-op import without
calling the classifier, or (c) gitignore the suffix of session-log.md
lines that match the smoke-test pattern (least preferred — hides real
information).

**Regression test**: a future test should assert
`./scripts/autodev_doctor.sh` exits 0 AND leaves `git status` clean.

**Keywords**: doctor, autodev_doctor, session-log, import-side-effect,
working-tree-dirty, cli-classify, audit-log-leak, cycle-clean

---

## FAIL-0010: V3 supervisor stuck at inner_engine_exit_3 with `blocked=true` for hours

**Date**: 2026-05-11 (V3 E2E test, captured in
`reports/state.json` at HEAD time before L7 bootstrap)

**Symptom**: After ~2 hours into the V3 E2E test, `reports/state.json`
showed:
```json
{
  "blocked": true,
  "blocker_reason": "inner engine exit 3",
  "current_phase": "selected",
  "current_task_id": "TASK-V3-1778496611",
  "next_action": "continue_current_task"
}
```
The supervisor was alive but refusing to dispatch new work. No
`state/PAUSED` file existed (so it wasn't a Guardian pause). The blocker
was just a stuck "inner engine exit 3" with no diagnostic context.

**Root cause** (suspected, not fully confirmed): the inner-engine
subprocess returned exit code 3 — which historically means "no shadow
branch found" — but the recovery layer treated any non-zero exit as a
generic blocker without classifying. The supervisor then sat on the
blocker for the configured hold-duration without surfacing the actual
classification.

**Failed fix attempts**:
- (rejected) Lower the hold-duration. Treats symptom, not cause.
- (rejected) Always re-run the inner engine on exit 3. Could loop.

**Working fix**: planned (NOT YET SHIPPED). The Diagnose-mode work
(Track P4 in BACKLOG) is the right shape: when a blocker recurs >=2
times with the same `blocker_reason`, transition to Diagnose, collect
evidence (exit code, last 100 lines of stderr, current shadow-branch
state), and either auto-recover or escalate with full context. Until
Diagnose lands, the supervisor's blocker_reason field should at minimum
distinguish "exit 0 with no PR" from "exit 1 with stderr" from "exit
2/3/N with no shadow branch".

**Regression test**: not yet (lands with Diagnose).

**Keywords**: supervisor, inner_engine_exit_3, blocker, stuck-blocker,
no-pause-file, hold-duration, diagnose-mode, blocker_reason-coarse,
state.json, recovery-loop
