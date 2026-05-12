# Cycle 20260512-052433 PLAN — Track T5 attempt → DOCUMENTED BLOCKER

## Target dim
T (Test oracle)

## Original goal
Lift T-dim L4 → L5 by running mutmut on `orchestrator/billable.py` and
capturing the kill rate to `reports/mutmut-kill-rate.txt`.

## Result
**FAIL, redirected to documentation.**

mutmut 3.3.1 was installed via `pip3 install --user mutmut`. A
minimal `pyproject.toml [tool.mutmut]` config was tested:

```toml
[tool.mutmut]
paths_to_mutate = ["orchestrator/billable.py"]
tests_dir = ["tests/"]
runner = "python3 -m pytest -q --no-cov tests/test_v4_hardening.py tests/test_billable_properties.py"
```

`mutmut run` proceeded past mutant generation (122ms) then failed in
the stats phase: collection of all `tests/test_*.py` fails because
mutmut 3.x's mutant-tree copy only includes the paths in
`paths_to_mutate`, so cross-module imports in OTHER test files (e.g.
`tests/test_action_evaluator.py` importing `action_evaluator`) raise
ModuleNotFoundError when run from `mutants/tests/`.

Rolled back cleanly to `autoevo/pre-20260512-052433`. No code changes
committed in the cycle-14 attempt. The L7 tag was deleted along with
the abandoned branch; re-created as `autoevo/pre-20260512-052433`
for this documentation cycle.

## What this cycle DID accomplish

1. Documented the mutmut 3.x tooling blocker as `FAIL-0011` in
   `FAILURES.md` (with full provenance: install command, config tried,
   exact error path, root cause, four candidate workarounds).
2. FAILURES.md now has 11 entries (was 10).
3. The Track T5 BACKLOG entry stands open. A future cycle can take
   any of the four FAIL-0011 workarounds.

## Acceptance criteria (for the DOCUMENTATION cycle)
- [x] FAIL-0011 entry added with full schema
- [x] FAILURES.md integrity tests still pass
- [x] No regression in any compute_level dim
- [x] No code change to production modules

## Files (closed set)
- `FAILURES.md` (+ FAIL-0011)
- `cycles/20260512-052433/{PLAN,RESULT,REPORT,STATE.before,verify-output,next-track-proposal}.md/json`
- `CHANGELOG.md` (FAIL line)
- `STATE.md` (rewrite)
- `LEVEL.md` (regenerate; no value change)

## Forbidden
- (kept) production code, secrets, LEVEL hand-edit

## Rollback
`git reset --hard autoevo/pre-20260512-052433`

## Risk score
none — pure documentation of an external-tool blocker.

## FAILURES.md pre-flight
Preflight ran clean on the documentation rewrite (only "mutmut" /
"tooling" keywords; no FAIL- overlap).

## Open questions
None.
