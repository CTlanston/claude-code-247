# Cycle 20260513-141046 PLAN — Cycle 33 (fix FAIL-0009)

## Target dimension

S (Safety gates) — minor strengthening of the test-isolation
contract. Adds a known-good idiom for keeping audit-log writes
out of unit tests. No rubric level move (S already at L7 max);
contributes to the C-streak only.

## Specific gap being closed

`reports/session-log.md` gets dirtied on every `pytest` run in
this repo. The handoff doc from the previous session names this
as the highest-value next pickup and the named risk for the
launchd-driven path: the wake script's §4 step 1 ("git status
must be clean") would write BLOCKED.md on every wake otherwise.

The FAILURES.md entry for FAIL-0009 attributes this to the
DOCTOR script, but empirical testing shows the doctor is
innocent — the audit-log lines come from the cli executor unit
tests in `tests/test_autodev_claude_code_cli.py`, which exercise
the real `_log()` writer against the real
`reports/session-log.md` path.

This cycle does TWO things:
1. **Ship the actual fix** — env-var-gated suppression in
   `_log()`, set globally for pytest via `tests/conftest.py`.
2. **Correct the failure ledger** — update FAIL-0009's
   "Root cause" + "Working fix" sections to reflect what we now
   know on disk. The M-dim discipline says: when evidence
   contradicts the ledger, fix the ledger.

## Change being made

1. **`autodev/executors/claude_code_cli.py:_log()`**
   At the very start of `_log()`, check
   `os.environ.get("AUTODEV_AUDIT_LOG_SUPPRESS")`. If truthy
   (non-empty), return immediately without writing. This is the
   minimal, side-effect-free guard.

2. **`tests/conftest.py`**
   Add a session-scoped autouse fixture that sets
   `os.environ["AUTODEV_AUDIT_LOG_SUPPRESS"] = "1"` at session
   start (already runs there per pytest fixture rules). All
   pytest-driven imports + code paths inherit it.

3. **`tests/test_doctor_no_side_effect.py`** (NEW regression):
   Two tests:
   - `test_doctor_leaves_session_log_clean`: snapshot
     `reports/session-log.md`, run `bash scripts/autodev_doctor.sh`,
     compare snapshot equals current content.
   - `test_pytest_run_leaves_session_log_clean_with_suppress`:
     run a subprocess `python3 -m pytest tests/test_autodev_claude_code_cli.py -q`
     with `AUTODEV_AUDIT_LOG_SUPPRESS=1` in the env, verify
     `reports/session-log.md` is unchanged.
   The first test confirms the doctor was always innocent.
   The second test pins the actual fix.

4. **`FAILURES.md`** — update FAIL-0009 entry:
   - Correct "Root cause" to identify the cli-executor unit
     tests (not the doctor).
   - Update "Working fix" to describe the
     `AUTODEV_AUDIT_LOG_SUPPRESS` env-var gate.
   - Add a "Regression test" line citing the new test file.
   - **Preserve** the original failed-fix-attempts text; this
     is an append-only ledger correction, not a rewrite. The
     symptom paragraph stays; the root cause + working fix
     get a "Corrected 2026-05-13 (Cycle 33)" sub-block appended
     so the original misattribution is preserved as a learning
     artifact.

## Acceptance criteria

- [x] `tests/test_doctor_no_side_effect.py` exists, 2 tests
- [x] `pytest tests/` green (no test regresses)
- [x] After running pytest, `git diff reports/session-log.md`
      shows nothing new (the suppress fixture takes effect)
- [x] After running doctor, `git diff reports/session-log.md`
      still shows nothing new (it never wrote in the first place)
- [x] FAIL-0009 entry updated with corrected root cause +
      working fix sections
- [x] `compute_level --check` green (after propose-first)
- [x] `autodev_doctor.sh`: 13/0/2

## Files to touch (closed set)

- `autodev/executors/claude_code_cli.py` (one method, ~3 lines)
- `tests/conftest.py` (add fixture)
- `tests/test_doctor_no_side_effect.py` (new)
- `FAILURES.md` (FAIL-0009 entry: append "Corrected" block)
- `CHANGELOG.md` (one line)
- `BACKLOG.md` (mark FAIL-0009 fix done; surface next P0)
- `STATE.md` (rewrite)
- `cycles/20260513-141046/PLAN.md` (this)
- `cycles/20260513-141046/REPORT.md`
- `cycles/20260513-141046/RESULT.md`
- `cycles/20260513-141046/next-track-proposal.json`
- `reports/zero-deadlock-streak.txt` (13→14)
- `reports/cycle-history.jsonl` (append)
- `reports/session-log.md` (committed as-is — append-only ledger
  artifact from prior session; the suppress fixture prevents
  future drift from this cycle forward)

## Files forbidden to touch

- `.env*`, `secrets/**`, `LEVEL.md` (computed), anything in §0.
- Other test files. The fix is non-invasive at the executor
  level; existing tests should pass unchanged.

## Rollback plan

`git reset --hard autoevo/pre-20260513-141046`. The change is
small and reversible.

## Risk score

low. The env-var gate is opt-in (suppress only when explicitly
set), and the session-scoped conftest fixture is the only place
the var is set in this repo. Production paths (the actual cli
executor calls during real runs) do NOT set this var, so audit
logging continues normally.

## FAILURES.md pre-flight result

Keywords: doctor, session-log, audit, executor, cli, classify,
import, side-effect, working-tree-dirty.

- **FAIL-0009** matched (target of this cycle). Cited and
  resolved — the entire cycle exists to ship the working fix
  and correct the misattribution.
- No other FAILURES.md matches.

## Open questions / blockers

None. The bug is reproduced, the fix is identified, the test is
designed.
