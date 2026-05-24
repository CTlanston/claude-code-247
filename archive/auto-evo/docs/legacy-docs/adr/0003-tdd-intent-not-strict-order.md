# ADR-0003: Reviewer enforces TDD intent, not strict per-commit ordering

## Context

V3 E2E test (2026-05-11) on issue #14 ("chunks") produced a clean PR that
Reviewer rejected because of TDD-order policy:
- Commit history was `test: add chunks tests → feat: implement chunks →
  test: add edge-case empty-list test`
- The pre-V3 `_check_tdd_invariant` required a strict prefix-only gate:
  every commit must be in the order `test, test, ..., feat, feat, ...`.
  The trailing edge-case test commit violated that gate.
- The Reviewer's role prompt mirrored the strict gate language.

This rejected a legitimate TDD-following PR. Real TDD has people adding
edge-case tests AFTER the main implementation lands. The strict gate punished
correct behaviour.

## Decision

Rewrite `_check_tdd_invariant` in `orchestrator/main.py` as an **intent**
detector:

```python
_TEST_COMMIT_RE = re.compile(r"\s*(test|tests|spec|specs|coverage):\s",
                             re.IGNORECASE)
_IMPL_COMMIT_RE = re.compile(r"\s*(feat|fix|impl|implement|refactor):\s",
                             re.IGNORECASE)
```

Pass condition (A AND B):
- A: at least one commit matches `_TEST_COMMIT_RE` AND the diff has
  substantive `tests/**` content
- B: at least one test-commit timestamp PRECEDES at least one impl-commit
  timestamp

Fail conditions (red-line, request_changes):
- No tests at all (A fails)
- ALL test commits land AFTER ALL impl commits (B fails)

Edge-case test commits after impl are explicitly allowed.

Mirror updates to `orchestrator/roles/reviewer.md` and `runner/roles/reviewer.md`
so the LLM Reviewer's policy matches the deterministic gate.

## Consequences

Good:
- V3 #14-style PRs no longer rejected for legitimate trailing edge-case
  tests.
- The deterministic gate matches the model's role-prompt policy.
- Real "no tests" / "tests-only-after-all-impl" cases are still rejected.

Bad:
- Slightly more permissive — a Coder that writes the impl first and bolts
  on a single trivial test commit after the fact could pass intent. Mitigated
  by clause A ("diff has substantive tests/** content, not empty file or
  docstring-only").
- The intent check requires reading commit timestamps, which is slightly
  more I/O than the prefix-only check. Negligible at our scale.

## Alternatives Rejected

- **Keep strict per-commit ordering.** Rejected: punishes correct TDD with
  edge-case tests after impl.
- **Drop the TDD invariant entirely; rely on Reviewer LLM judgment.**
  Rejected: the LLM Reviewer is probabilistic. A deterministic gate is
  cheaper and more reliable.
- **Require ALL test commits before any impl commit, but allow edge cases
  via a special prefix like `test-edge:`.** Rejected: nobody will remember
  to use the special prefix. Intent detection is the simpler rule.

## Linked regression test

- `tests/test_v4_hardening.py::test_tdd_intent_accepts_edge_case_test_after_impl`
- `tests/test_v4_hardening.py::test_tdd_intent_rejects_no_tests`
- `tests/test_v4_hardening.py::test_tdd_intent_rejects_all_tests_after_all_impl`
- `tests/test_v4_hardening.py::test_tdd_intent_accepts_classic_red_green`
- `tests/test_v4_hardening.py::test_tdd_intent_handles_mixed_case_prefixes`
- `tests/test_v4_e2e_replay.py::test_v4_scenario_14_edge_case_test_after_impl_passes_tdd_gate`

## Linked cycle

Original implementation: commit `110e7bd` (V4 Track 3, pre-L7).
Ratified into L7 memory: Cycle `20260512-042701` (Bootstrap).
