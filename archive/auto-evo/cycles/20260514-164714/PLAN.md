# Cycle 20260514-164714 PLAN — FAIL-0005 empirical reproduction + latent NameError fix

## Target dimension

M (Memory / failure-ledger discipline). Convert FAIL-0005's
`empirically_reproduced: no` → `yes` per the Cycle 41/42/43 discipline
thread. Continues the Cycle 44 "first no→yes flip" pattern: this is
the **second** `no` → `yes` conversion in the ledger.

Side effect: also lifts a latent bug uncovered by empirical
reproduction (see "Gap" below).

## Gap

FAIL-0005 was marked `no` (root cause inferred from logs only).
Empirical inspection of `orchestrator/github_client.py:latest_workflow_run_status`
reveals the V3-era "Working fix" shipped with a latent bug:

```python
    except Exception as e:  # noqa: BLE001
        log.warning("latest_workflow_run_status(%s) failed: %s", branch, e)
        return None
```

The bare name `log` is never imported or defined in the module
(grep'd — only stdlib + Path/Optional imports). Any time the inner
`try` block raises (the exact scenario FAIL-0005 was meant to
defend against), the `except` clause itself raises `NameError`,
which propagates out and freezes the inner-engine loop — the
SAME symptom FAIL-0005 was supposed to fix.

The "Working fix" therefore worked accidentally (mocked tests
never exercised the exception path); it would fail in production
the first time a transient PyGithub error occurred.

## Change

1. **`orchestrator/github_client.py`** (2 lines):
   - Add `import logging` at the top.
   - Add `log = logging.getLogger(__name__)` at module level.

2. **`tests/test_github_client_workflow_status.py`** (NEW):
   Regression tests for FAIL-0005. Each test patches `_local_mode`
   to return False and `_gh` to return a controllable double:
   - `test_indexerror_in_runs_subscript_returns_none` — `runs[:1]`
     raises IndexError → function returns None (does NOT raise
     NameError). **Empirically reproduces the symptom of FAIL-0005.**
   - `test_generic_github_exception_returns_none` — `_gh()` raises a
     generic Exception → function returns None.
   - `test_totalcount_exception_falls_through` — `runs.totalCount`
     raises → function continues past the defensive total check.
   - `test_totalcount_zero_returns_none` — totalCount == 0 short-circuits.
   - `test_success_conclusion_returned` — runs[0].conclusion = "success"
     → returns "success".
   - `test_none_conclusion_means_running` — runs[0].conclusion = None
     → returns "running" (the `or "running"` fallback).
   - `test_log_warning_does_not_namerror` — pre-fix anchor: directly
     exercise the except branch and assert no NameError. (Without the
     fix, this test raises NameError; with the fix, it returns None.)

3. **`FAILURES.md`** (FAIL-0005 entry):
   - Flip `**Empirically reproduced**: no` → `yes`.
   - Update "Working fix" to cite the Cycle 45 NameError correction.
   - Update "Regression test" to point at the new test file.
   - Append a "Cycle 45 verification" sub-block describing what
     empirical reproduction revealed (the latent NameError) and
     how the corrected fix works.

## Acceptance criteria

- New test file exists and contains the 7 tests above.
- Before the github_client.py fix: at least one test FAILS with
  NameError (proving empirical reproduction of FAIL-0005's symptom).
- After the github_client.py fix: all 7 tests PASS.
- `pytest -q` overall: green (639+7 → 646 passed, 2 skipped).
- `python3 scripts/autodev_doctor.sh` exits 0.
- `python3 scripts/propose_next_track.py --for-cycle 20260514-164714`
  written FIRST (per Cycle 25 procedural lesson).
- `python3 scripts/compute_level.py --check` passes (no regression).
- FAILURES count moves 5y/4n/1c/1na → 6y/3n/1c/1na (FAIL-0005 flips).
- STATE.md updated; CHANGELOG.md gets one new line; BACKLOG.md
  marks Cycle 45 done.
- zero-deadlock-streak.txt bumps 25 → 26 (single-stream cycle, no
  worktree dispatch; use Scheduler.record_cycle_success per the
  established Cycle 41-44 pattern).
- cycle-history.jsonl gets one new entry.

## Closed file set (atomic commit)

- `orchestrator/github_client.py` (modify: 2 lines added)
- `tests/test_github_client_workflow_status.py` (new)
- `FAILURES.md` (modify: FAIL-0005 entry)
- `cycles/20260514-164714/PLAN.md` (this file)
- `cycles/20260514-164714/REPORT.md` (new)
- `cycles/20260514-164714/RESULT.md` (new)
- `cycles/20260514-164714/next-track-proposal.json` (new)
- `CHANGELOG.md` (append 1 line)
- `BACKLOG.md` (mark Cycle 45 done)
- `STATE.md` (rewrite)
- `reports/zero-deadlock-streak.txt` (bump)
- `reports/cycle-history.jsonl` (append)

## Forbidden files

- Anything in `autodev/`, `runner/`, `scripts/`, `docs/adr/`,
  `worktrees/`, `state/`, `.claude/`, other tests, other
  orchestrator modules. Cycle stays single-concern.

## Rollback plan

`git reset --hard autoevo/pre-20260514-164714` returns to the
exact pre-cycle state. The tag is set before any edits.

## Risk score

LOW.
- 2-line import addition; standard Python pattern; no behaviour
  change for the success path.
- All test cases use unittest.mock; no network, no PyGithub
  install dependency (tests only patch `_gh`).
- The fix corrects a latent bug, not a working path — improvement
  is monotonic.

## FAILURES.md pre-flight

Checked entries with keywords matching this cycle's approach:
- **FAIL-0005** — this cycle's target. Empirically reproduced
  field is currently `no`; per the Cycle 42 verify-before-relying
  rule, this cycle DOES reproduce empirically (option b in the
  rule) AND corrects the working-fix implementation. Output:
  flip to `yes` + Cycle 45 verification sub-block (not the
  `corrected_in_<id>` value — root cause attribution was
  correct; only the implementation was buggy).
- **FAIL-0009** — different layer (audit-log side effect vs.
  defensive-exception NameError). Not a repeat.
- **FAIL-0004** — different system (state-dir resolution silent
  fallback vs. PyGithub exception handling). Not a repeat.

`scripts/preflight_failures.py --plan cycles/20260514-164714/PLAN.md
--strict` will be run as Step 3 ACT-phase gate; pass required.

## Open questions

None — the change is mechanical and the empirical reproduction
is straightforward.
