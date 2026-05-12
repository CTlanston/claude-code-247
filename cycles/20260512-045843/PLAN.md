# Cycle 20260512-045843 PLAN — Track T2-property-tdd-intent (3/3)

## Target dim
T (Test oracle)

## Specific gap
3rd of 3 property-test modules needed for T-dim L4. After this, T → L4.
Overall L is *still* expected to stay 3 because R and C are floor at L3,
but T-L4 is the third dim above the floor.

## Change being made

`tests/test_tdd_intent_properties.py` — Hypothesis properties on
`orchestrator.main._check_tdd_invariant`. Properties:

1. Empty commit list → "no commits on shadow branch" error
2. Commit list with no test/spec commits AT ALL → fails with "no test"
3. Commit list with no impl commits AT ALL → fails with "no impl"
4. Sequence [test:, ..., feat:] always passes (None)
5. Sequence [feat:, ..., feat:, test:] (all tests after all impl)
   always fails
6. Sequence where ≥ 1 test comes before ≥ 1 impl → passes (mixed)
7. Idempotent: re-calling with same commit list returns same result

Strategy: use `unittest.mock.patch` to swap `git_proxy.commit_log` with
a stub that returns the Hypothesis-generated commit list.

## Acceptance criteria
- [ ] `tests/test_tdd_intent_properties.py` exists with ≥ 5 `@given`
      properties
- [ ] All pass at default Hypothesis settings
- [ ] `pytest -q` full suite green
- [ ] `LEVEL.md` shows `T = 4` after this cycle
- [ ] `scripts/compute_level.py --check` exits 0

## Files to touch (closed set)
- `tests/test_tdd_intent_properties.py` (new)
- `cycles/20260512-045843/{PLAN,RESULT,REPORT,STATE.before,verify-output,next-track-proposal}.{md,json}`
- `BACKLOG.md`, `STATE.md`, `CHANGELOG.md`, `LEVEL.md`

## Forbidden
- secrets, hand-edit LEVEL.md, production code (`orchestrator/main.py` is
  the module under test — not modified)

## Rollback
`git reset --hard autoevo/pre-20260512-045843`

## Risk score
low

## FAILURES.md pre-flight
Run after writing. Expected matches around "tdd" / "test" — both
appearing in FAIL-0001 (TDD ordering). The cycle TESTS the V4 fix; not
a re-introduction.

## Open questions / blockers
None.
