# Skill: matt.tdd

> A Wave 1 stub. Track K2 (future) will wire this into the
> `orchestrator/skill_router.py` classifier.

## Purpose

Enforce strict TDD discipline within a single §4 wake-cycle:
test first, watch it fail, implement the smallest change that
passes, commit atomically.

## When to invoke

Trigger this skill when the cycle's PLAN involves:

- Implementing a new function / module / endpoint
- Adding a feature to an existing module
- Fixing a bug that has no current regression test
- Any change that the L7 rubric Dim T (Test oracle) cares about

This skill is the DEFAULT for almost every cycle. Skip it only
for pure-documentation cycles (Phase C, milestones) or pure-rename
refactors where existing tests already lock in behavior.

## What this skill does

Three steps, in order:

1. **Write the regression test first**. The test must fail when
   run against the current code (because the feature/fix doesn't
   exist yet). Watch the failure; understand it.
2. **Implement the minimum code change** that turns red → green.
   Resist adding anything beyond what the test asserts.
3. **Commit atomically** on the cycle branch with a
   Conventional-Commits prefix (`feat:` / `fix:` / `test:`).

The `_check_tdd_invariant` gate in `orchestrator/main.py` enforces
that the commit log shows at least one `test:` / `tests:` / `spec:`
commit before any `feat:` / `fix:` / `impl:` commit on the branch.
This skill aligns with that gate.

## What this skill does NOT do

- **Does NOT** require strict prefix-only ordering. Per FAIL-0001
  + ADR-0003, the gate detects TDD INTENT (at least one test
  commit + substantive tests/ diff content), not rigid commit
  prefixes. Trailing edge-case tests after impl are allowed.
- **Does NOT** count "added a print statement" or "tweaked
  whitespace" as a substantive test commit. The gate inspects
  the diff for real `tests/**` content.
- **Does NOT** auto-generate tests via an LLM call. Tests must
  be human-authored or designed-by-the-cycle's-author with
  explicit oracle.

## Exit criteria

- At least one new test exists in `tests/**`
- The test FAILS at HEAD before the implementation commit
- The test PASSES after the implementation commit
- `_check_tdd_invariant(branch)` returns ok=True

## Related artifacts

- `AUTODEV_L7_MASTER_PROMPT.md` §3 Dim T rubric
- `orchestrator/main.py:_check_tdd_invariant`
- `docs/adr/0003-tdd-intent-not-strict-order.md`
- `FAIL-0001` in `FAILURES.md`
