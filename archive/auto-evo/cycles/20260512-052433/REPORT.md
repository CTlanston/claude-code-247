# Cycle 20260512-052433 Report — Track T5 → FAIL_AS_DATA

## Verdict
**FAIL_AS_DATA**. T-dim did NOT move L4→L5 because mutmut 3.3.1
cannot be configured to ignore cross-module test imports in its
stats-phase collection. The cycle rolled back cleanly; the learning
is captured as FAIL-0011 in FAILURES.md.

Per L7 §8: "The cycle still counts — failure is data, it advances the
FAILURES dim implicitly."

## What was attempted

1. `pip3 install --user mutmut` → 3.3.1
2. minimal `pyproject.toml [tool.mutmut]` with `paths_to_mutate =
   ["orchestrator/billable.py"]`, `tests_dir = ["tests/"]`, runner
   restricted to billable-relevant tests
3. `mutmut run` proceeded past mutant generation (122ms) then failed
   in stats phase: `mutants/tests/test_action_evaluator.py` ImportError
   because `action_evaluator.py` is NOT copied to `mutants/orchestrator/`
   (only `paths_to_mutate` is copied)

## Why it failed
mutmut 3.x's mutant-tree copy mechanism is too narrow for repos with
multiple sibling orchestrator modules whose test files import them.
The stats phase tries to collect ALL `tests/` regardless of the
configured `runner`, hitting the cross-module imports first.

## What was preserved
- Clean rollback to `autoevo/pre-20260512-052433`
- No code changes to production modules
- No working-tree pollution after rm of `mutants/` and `pyproject.toml`
- This cycle's artifacts (PLAN/RESULT/REPORT/STATE.before/verify) committed

## What was learned
Documented as **FAIL-0011** in FAILURES.md with four candidate
workarounds:
1. Conditional pytest skipif on MUTMUT env var
2. mutmut 2.x in a separate venv
3. Homegrown small-scope mutator for billable.py (95 lines)
4. Wait for upstream mutmut fix

Best ROI for the next cycle: option 3 (homegrown mutator). billable.py
is small enough to hand-code a mutator + use the existing 6 property
tests + 9 unit tests as the kill set.

## Files modified
```
FAILURES.md                            (+FAIL-0011)
CHANGELOG.md                           (cycle 14 line: FAIL→data)
BACKLOG.md                             (Track T5 → T5-workaround)
STATE.md                               (rewritten; open_blocker FAIL-0011)
LEVEL.md                               (regenerated; no value change)
cycles/20260512-052433/*               (PLAN/RESULT/REPORT/STATE.before/
                                        verify-output/proposal)
```

## Verify
- pytest: 238 passed, 1 skipped, 0 failed
- compute_level --check: passed (no regression)
- doctor: 11/0/2
- M=L7 still (FAILURES has 11 entries now)

## Next track
T5-workaround (option 3 recommended), OR operator unblocks R via
`brew install codex`.

## Wall clock
~10 minutes attempt + ~5 minutes documentation = 15 min.
