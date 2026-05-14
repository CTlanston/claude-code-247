# FAILURES.md — indexed failure ledger

> Append-only. Every PLAN must grep this file for keywords matching its
> approach. If a hit is found, cite why this time is different OR pick a
> different approach. See §5 of `AUTODEV_L7_MASTER_PROMPT.md`.

## Entry schema

Each entry uses these fields:

- `**Date**:`           — when the failure was observed
- `**Empirically reproduced**:` — root-cause-confidence tag.
  One of:
  - `yes` — working fix demonstrated to resolve symptom AND a
    regression test exists that exercises it.
  - `no` — root cause inferred from logs / reasoning / analogy;
    no empirical reproducer was run. Future cycles **must
    verify** before relying on this entry's root cause.
  - `corrected_in_<cycle-id>` — was `no`, but a later cycle
    reproduced empirically and either confirmed or corrected
    the root cause via an appended "Corrected diagnosis"
    sub-block.
  - `not_applicable` — tooling / environmental issue where
    empirical reproduction isn't meaningful (e.g. mutmut
    version compatibility).
- `**Symptom**:`        — what was observed
- `**Root cause**:`     — what caused it
- `**Failed fix attempts**:` — what didn't work and why
- `**Working fix**:`    — what does work
- `**Regression test**:` — test file/path or "not yet"
- `**Keywords**:`       — comma/whitespace list for grep
- `**Linked ADR**:` (optional) — corresponding ADR

The `empirically_reproduced` field was added in
**Cycle 41 (20260513-162424)** per the discipline rule surfaced
in Cycle 33's correction of FAIL-0009.

## FAIL-0001: Reviewer rejected TDD-compliant PR for trailing edge-case test

**Date**: 2026-05-11 (V3 E2E test, issue #14 "chunks")

**Empirically reproduced**: yes (V4 commit `110e7bd` shipped with
regression tests `tests/test_v4_hardening.py::test_tdd_intent_*`
that fail without the fix and pass with it)

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

**Empirically reproduced**: yes (V4 preflight regression tests
`tests/test_v4_hardening.py::test_preflight_impossible_spec_*`
fail without the fix and pass with it)

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

**Empirically reproduced**: yes (V4 commit `110e7bd` shipped with
regression tests `tests/test_v4_hardening.py::test_db_record_run_zeros_*`
+ `test_billable_load_budget_*` exercising the to_billable_cost
helper)

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

**Empirically reproduced**: yes (4 V4 regression tests in
`tests/test_v4_hardening.py::test_resolve_state_db_path_*` and
`test_pending_work_*` exercise every env-var precedence branch)

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

**Empirically reproduced**: yes (Cycle 45 `20260514-164714` added
`tests/test_github_client_workflow_status.py` with 7 tests that
patch `_local_mode` + `_gh` to trigger the failure paths;
test_indexerror_in_runs_subscript_returns_none fails on the
pre-Cycle-45 code with the exact production symptom AND surfaces
a latent NameError in the "Working fix" — see the "Cycle 45
verification" sub-block at the end of this entry).

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

**Working fix**:
1. (pre-V4, V3 cleanup era) commit `9df48f6` — wrap the PyGithub
   call site in `try / except Exception`, log a warning, return
   `None`; probe `runs.totalCount` defensively (also try/except).
2. (Cycle 45, `20260514-164714`) Fixed a latent NameError shipped
   in step 1: the except branch called `log.warning(...)` but the
   `log` name was never imported/defined at module scope, so any
   real exception path raised `NameError` and propagated — i.e.
   the "defensive" fix reproduced FAIL-0005's original symptom
   via a different code path. Cycle 45 added
   `import logging` + `log = logging.getLogger(__name__)` at
   module top. With both fixes in place, the except branch now
   logs and returns `None` as originally intended.

**Regression test**:
- `tests/test_github_client_workflow_status.py` (Cycle 45, 7
  tests): IndexError in `runs[:1]` → None; generic exception
  in `_gh()` → None; `runs.totalCount` raises → swallowed and
  falls through; `totalCount == 0` → None; success conclusion
  passes through; None conclusion → "running"; module exposes
  `log` as `logging.Logger`.

**Keywords**: pygithub, paginatedlist, indexerror, workflow-runs,
shadow-branch, dispatch-freeze, github-client, latest_workflow_run_status,
defensive-exception, transient-api, namerror, latent-bug, logging

### Cycle 45 verification (2026-05-14, `20260514-164714`)

Empirical reproduction (TDD discipline):

```bash
$ git checkout autoevo/pre-20260514-164714
$ python3 -m pytest tests/test_github_client_workflow_status.py -q
...
E   NameError: name 'log' is not defined
orchestrator/github_client.py:157: NameError
=== 3 failed, 4 passed in 0.13s ===
```

The IndexError code path (the exact scenario FAIL-0005 was
filed against) raised `NameError` because line 157's
`log.warning(...)` referenced an undefined name. The defensive
fix was shipped without a regression test; mocked tests would
have caught this on day one. Under real PyGithub the first
transient API hiccup would have re-frozen the inner-engine
loop with a confusing `NameError` traceback instead of the
original IndexError — strictly worse than no fix at all
(now plus a misleading stack).

After Cycle 45's `import logging` + `log = logging.getLogger(__name__)`
addition (2 lines, byte-identical for all success paths), all
7 tests pass; the except branch logs the warning as intended
and returns `None`.

**Lesson**: defensive `except Exception:` clauses must be
exercised by at least one unit test. A try/except without a
regression test exercising the except branch is **not** a fix
— it's a latent multiplier on the original failure mode.

---

## FAIL-0006: Bare-remote missing → mirror_to_github silently dropped the push, leaving an empty shadow branch on GitHub

**Date**: 2026-05-11 (V3 E2E test, observed for issues #14 and #15 on
the first dispatch of each shadow branch)

**Empirically reproduced**: no (fix shipped without regression
test; would need fake-GitHub fixture. Tracked as future Track-T
candidate. Future cycle should reproduce against a fake remote
before relying on the inferred root cause.)

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

**Empirically reproduced**: no (fix is planned but not yet
shipped; the inferred root cause is supported by symptom
analysis but the working `INSERT OR IGNORE` migration has not
been demonstrated. Future cycle should ship the migration AND
a regression test that triggers the double-write before fix
and verifies single-row after.)

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

**Empirically reproduced**: yes (Cycle 44 shipped a root
`.dockerignore` excluding state/, workspaces/, worktrees/,
.env*, secrets/, *.key, *.pem, id_rsa*, __pycache__/, *.pyc,
.venv/, cycles/, reports/runs/, plus other operational paths;
regression test `tests/test_dockerignore.py` verifies each
critical pattern + sanity-checks no pattern over-excludes the
orchestrator/runner Dockerfile locations or the autodev/ Python
package)

**Symptom**: `docker build` for both `orchestrator/Dockerfile` and
`runner/Dockerfile` copied the entire repo context, including
`state/*.db` (live DB), `workspaces/` (per-issue clones, possibly
gigabytes), `.env` (SECRET — would leak into the image layer), and all
`__pycache__/`. Resulting images were 800MB+ and shipped credentials.

**Root cause**: No `.dockerignore` in the repo root. `Dockerfile`s did
`COPY . /workspace` blindly.

**Failed fix attempts**: none (caught early in inner-engine development).

**Working fix**: SHIPPED in Cycle 44 (20260513-163910). Root
`.dockerignore` excludes:
- `state/` (live SQLite DBs + lock files)
- `workspaces/` + `worktrees/` (per-issue clones, possibly GBs)
- `.env*`, `secrets/`, `*.key`, `*.pem`, `id_rsa*` (§0 rule 3)
- `__pycache__/`, `*.pyc`, `.venv/`, `.python-version`,
  `.hypothesis/` (Python build noise)
- `.git/` (huge; never in image)
- `cycles/`, `reports/runs/` + several `reports/*.{jsonl,log}`
  (L7 telemetry, not runtime)
- `docs/`, top-level `*.md`, `.vscode/`, `.idea/`, `.DS_Store`
  (not runtime)

**Regression test**: `tests/test_dockerignore.py` (Cycle 44,
15 assertions: existence + 9 pattern-presence checks +
sanity checks against over-exclusion + cross-reference that
this entry's Empirically reproduced field is "yes").

**Keywords**: dockerignore, image-bloat, docker-build, credentials-leak,
.env-leak, build-context, runner-image, orchestrator-image, state-leak,
workspaces-leak

---

## FAIL-0009: doctor's "modules import cleanly" check side-effect dirties reports/session-log.md every cycle

**Date**: 2026-05-12 (observed during L7 Cycle 0 and Cycle 1 of this
session)

**Empirically reproduced**: corrected_in_20260513-141046
(original root-cause attribution to the doctor was INFERRED;
Cycle 33's cp/diff experiment proved the doctor is innocent —
pytest's cli-executor unit tests were the culprit. The
"Corrected diagnosis" sub-block below preserves the
misattribution as a learning artifact and documents the
empirically-verified actual fix.)

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

**Working fix**: SHIPPED in Cycle 33 (20260513-141046). See
"Corrected diagnosis" sub-block below.

**Regression test**: `tests/test_doctor_no_side_effect.py` (Cycle 33,
4 tests). Asserts both that the doctor is innocent AND that the
cli-executor unit tests no longer dirty the file when
`AUTODEV_AUDIT_LOG_SUPPRESS=1` is set.

**Keywords**: doctor, autodev_doctor, session-log, import-side-effect,
working-tree-dirty, cli-classify, audit-log-leak, cycle-clean

**Linked ADR**: docs/adr/0009-runtime-emission-no-tree-dirty.md
(Cycle 43; canonicalizes the discipline this entry's corrected
diagnosis surfaced — "runtime emission must not dirty the
tracked tree")

### Corrected diagnosis (2026-05-13, Cycle 33)

The original "Root cause" above was **wrong on disk evidence**.
Empirical test:

```bash
$ cp reports/session-log.md /tmp/before.md
$ bash scripts/autodev_doctor.sh > /dev/null
$ diff /tmp/before.md reports/session-log.md && echo "no change"
no change                                # doctor IS innocent
$ cp reports/session-log.md /tmp/before2.md
$ python3 -m pytest tests/test_autodev_claude_code_cli.py -q > /dev/null
$ diff /tmp/before2.md reports/session-log.md | head
# 4 lines appended                       # PYTEST is the culprit
```

**Actual root cause**: the unit tests in
`tests/test_autodev_claude_code_cli.py` (4 tests: rate_limit,
permission, success, timeout) call `ClaudeCodeCLIExecutor.run_prompt()`
with mocked subprocess responses. Those calls flow through
`_parse_result()` → `_log()`, which writes to the REAL
`reports/session-log.md` path in the repo. No test mocked
`session_log_path()` or `_log()`. Each pytest run appended 4
lines.

**Actual working fix**:
1. `autodev/executors/claude_code_cli.py:_log()` checks
   `os.environ.get("AUTODEV_AUDIT_LOG_SUPPRESS")` at the very
   start. If truthy, return without writing.
2. `tests/conftest.py` sets
   `os.environ.setdefault("AUTODEV_AUDIT_LOG_SUPPRESS", "1")` at
   import time, before any test collection. All pytest runs in
   this repo inherit the suppression. Production cli executor
   calls (real `claude -p` invocations from the orchestrator)
   run without pytest and never set this var; audit logging
   continues normally there.

**Why the misattribution happened**: the doctor's import line
(`python3 -c "import autodev, ..., autodev.executors.claude_code_cli, ..."`)
was the most plausible immediate suspect when FAIL-0009 was
first observed. Nobody actually ran the
`cp / doctor / diff` experiment until Cycle 33. M-dim discipline:
when evidence contradicts the ledger, fix the ledger.

**Lesson for future failure-ledger discipline**: every FAILURES.md
entry whose root cause was inferred (rather than empirically
reproduced) should be tagged so future cycles know to verify
before relying on it.

---

## FAIL-0010: V3 supervisor stuck at inner_engine_exit_3 with `blocked=true` for hours

**Date**: 2026-05-11 (V3 E2E test, captured in
`reports/state.json` at HEAD time before L7 bootstrap)

**Empirically reproduced**: no (root cause is "suspected" per
the entry's own language; Diagnose-mode work in Track P4 is
the planned proper reproducer. Future P4 cycle must verify
the inferred exit-3 classification before relying on this
entry.)

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

---

## FAIL-0011: mutmut 3.3.1 mutant-tree copy breaks cross-module imports

**Date**: 2026-05-12 (L7 cycle 14 aborted attempt)

**Empirically reproduced**: not_applicable (this is a third-party
tooling-version incompatibility, not a system root cause we'd
reproduce. Cycle 18 worked around it via Track T5 option 3 — a
homegrown AST-based mutator. The entry stays in the ledger as
a historical note about mutmut 3.x's mutant-tree copy mechanism.)

**Symptom**: Cycle 14 tried to lift T-dim 4 → 5 via mutmut on
`orchestrator/billable.py`. mutmut 3.3.1 was installed via
`pip3 install --user mutmut`. A minimal `pyproject.toml [tool.mutmut]`
section was written, then `mutmut run` proceeded past mutant
generation and failed in the stats phase with:
```
ImportError: tests/test_action_evaluator.py
ModuleNotFoundError: No module named 'action_evaluator'
```

mutmut 3.x copies the source tree to `mutants/` but only the files
listed in `paths_to_mutate`. Other orchestrator modules (action_evaluator,
preflight, intake_sanitizer, codex_reviewer, etc.) are missing from
`mutants/orchestrator/`, so test files that import them fail to
collect — even though those tests would NOT be run by the configured
`runner`. mutmut's stats phase tries to collect ALL tests in
`tests_dir` regardless.

**Root cause**: mutmut 3.x's mutant-tree copy mechanism is too narrow
for projects where test files import multiple sibling modules. The
older mutmut 2.x had a different (in-place) approach that worked.

**Failed fix attempts**:
- `paths_to_mutate` as a string → mutmut treated it as a list of
  chars and tripped on `FileNotFoundError: 'o'`
- `paths_to_mutate` as a single-element list → got past mutant
  generation but failed the stats phase via the import error above

**Working fix**: not yet shipped. Options under consideration:
1. Mark conditional `@pytest.mark.skipif(os.environ.get('MUTMUT'))`
   on tests that import non-billable orchestrator modules
2. Use mutmut 2.x in a separate venv (older but functional API)
3. Write a homegrown small-scope mutation tester targeting only
   `orchestrator/billable.py` (it's only 95 lines)
4. Wait for a mutmut 3.x release that fixes the copy logic

T-L5 evidence (`reports/mutmut-kill-rate.txt`) is unblocked as soon as
any of those options ships.

**Regression test**: not applicable (failure is a tooling issue, not a
code issue; will be addressed when the chosen workaround lands).

**Keywords**: mutmut, mutation-testing, mutant-tree, cross-module-import,
stats-phase, tooling-blocker, T-L5, hypothesis-already-installed,
pyproject-tool-mutmut

**Linked**: cycle 14 aborted with rollback to autoevo/pre-20260512-052433
(no commits landed).
