# Cycle 20260512-081235 PLAN — Track R6 (adversarial reviewer subagent)

## Target dimension
R (Review)

## Specific gap being closed

R-L6 per `compute_level.py`'s `REVIEW_MARKERS["adversarial_reviewer"]`
requires:
- A module file: one of
  `orchestrator/adversarial_reviewer.py`,
  `orchestrator/roles/adversarial_reviewer.md`, or
  `runner/roles/adversarial_reviewer.md`
- A test file `tests/test_adversarial_reviewer.py`
- That test contains the keyword `adversarial_reviewer`

Today none of those exist. Cycle 16 wired Codex (R-L5); this cycle adds
the **third independent reviewer** — single-purpose "find ways this
change breaks in production" — to lift R 5 → 6.

Per the user directive: add `runner/roles/adversarial_reviewer.md` with
the single-purpose prompt, then wire into `_do_review` as a third pass
after Claude + Codex. Disagreement detection: if Claude says APPROVE
and Adversarial says REJECT, ALERT.md gets the escalation.

## Change being made

1. **`runner/roles/adversarial_reviewer.md`** (new): a single-purpose
   role prompt for a Claude Code subagent. Lists what to look for
   (race conditions, N+1, trust-boundary violations, leak vectors,
   silent data loss) and what to ignore (style, naming, taste).
   Outputs structured verdict in the same shape as the main Reviewer:
   `{verdict, summary, comments}`.

2. **`orchestrator/adversarial_reviewer.py`** (new): Python adapter
   that invokes the adversarial role via the existing `runner.run_role`
   path. Wrapping it in its own module keeps the test stubs clean
   (mock `runner.run_role` once, get adversarial-specific behavior).
   API:
   ```python
   def run_adversarial_review(task: dict, issue_id: int)
                              -> AdversarialReview
   ```
   Returns a structured `AdversarialReview(verdict, findings,
   summary, reason)` parallel to `CodexReview`.

3. **`orchestrator/main.py:_do_review` extension**: after Codex
   review, run adversarial review. On Claude=APPROVE + Adversarial=
   REJECT, write ALERT.md (same protocol as Codex disagreement).
   The Claude verdict still remains decisive — adversarial review
   is an observer that escalates.

4. **`tests/test_adversarial_reviewer.py`** (new, ≥ 8 tests):
   role prompt file exists + module API + integration with _do_review.
   Mocks runner.run_role to avoid invoking real subagents.

5. **`scripts/compute_level.py`**: no changes needed — the existing
   `REVIEW_MARKERS["adversarial_reviewer"]` config already detects
   this once the files exist + the test references the keyword.

## Acceptance criteria
- [ ] `runner/roles/adversarial_reviewer.md` exists with single-purpose
      prompt
- [ ] `orchestrator/adversarial_reviewer.py` exists with
      `run_adversarial_review(task, issue_id)` returning an
      `AdversarialReview` dataclass
- [ ] `orchestrator/main.py:_do_review` invokes adversarial review
      after Codex; on Claude=APPROVE + Adversarial=REJECT writes ALERT.md
- [ ] `tests/test_adversarial_reviewer.py` has ≥ 8 tests, all green
- [ ] `pytest -q` full suite green
- [ ] `compute_level.py` reports `R = 6` ("Adversarial Reviewer active")
- [ ] `compute_level --check` exits 0
- [ ] CHANGELOG, STATE, BACKLOG, LEVEL all updated

## Files to touch (closed set)
- `runner/roles/adversarial_reviewer.md` (new)
- `orchestrator/adversarial_reviewer.py` (new)
- `tests/test_adversarial_reviewer.py` (new)
- `orchestrator/main.py` (small edit: import + 3rd-pass hook)
- `cycles/20260512-081235/*`
- `BACKLOG.md`, `STATE.md`, `CHANGELOG.md`, `LEVEL.md`
- Possibly `reports/codex-reviews.jsonl` (extended with adversarial
  verdict column) — TBD; if it adds a field, the existing integration
  tests need adjustment. For minimal scope this cycle, log adversarial
  results to a parallel `reports/adversarial-reviews.jsonl` instead.

## Files forbidden to touch
- secrets, LEVEL by hand
- `orchestrator/codex_reviewer.py` (Cycle 15-16's work; frozen this cycle)
- `tests/test_main_codex_integration.py` (don't reshape its mocks)
- `runner/roles/reviewer.md` (the main Reviewer's prompt; frozen)
- Other production code

## Rollback plan
`git reset --hard autoevo/pre-20260512-081235`

## Risk score
medium — touches `orchestrator/main.py:_do_review` (production code in
the core review path). Mitigated:
1. Adversarial call wrapped in try/except (failures don't crash flow)
2. Claude verdict remains decisive in ALL branches; adversarial is
   observer-only
3. Tests stub `runner.run_role` so no real Claude subagent fires in CI

## FAILURES.md pre-flight result

Preflight flagged two matches:
- **FAIL-0007** (record_run idempotency) on `issue_id` + `role` keywords —
  these appear in this PLAN because the adversarial reviewer API takes
  `(task, issue_id)` and is invoked alongside the other reviewer roles.
  This cycle does NOT touch `record_run` or the DB layer; the keyword
  overlap is just the natural domain vocabulary of the orchestrator.
  **Not a repeat of FAIL-0007.**
- **FAIL-0001** (V3 Reviewer over-strict TDD) on `reviewer` — this cycle
  ADDS a third reviewer; it does NOT modify the V4-softened TDD-intent
  gate that fixed FAIL-0001. Same pattern as cycles 7/16 (parallel
  reviewers, not modification of the existing gate). **Not a repeat.**

## Open questions / blockers
None.
