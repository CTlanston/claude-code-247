# Cycle 20260512-051335 PLAN — Track S4 (action-layer evaluator)

## Target dim
S (Safety)

## Specific gap being closed
Per L7 §9 formula `min(7, 2 + gates_with_regression_tests)`, S currently
has 4 gates (Guardian, TDD, preflight, intake_sanitizer) → S=L6. Adding
the 5th gate (action_layer_evaluator) brings the count to 5 → S=L7.

Per L7 §6 Track S4: "Action-layer evaluator — score every proposed
shell/git command before execution. Rule-based score 0-100; threshold
for auto-reject."

## Change being made

`orchestrator/action_evaluator.py`:
- `evaluate_action(cmd: str) -> ActionScore` where
  `ActionScore(safe: bool, score: int, flags: List[ActionFlag])`
- score 0-100 (higher = riskier):
  - rm -rf [path]               → +60 (rm -rf / → +90)
  - sudo / sudo -E              → +50
  - chmod 777                   → +30
  - curl|sh, wget|sh, |bash     → +50
  - git push --force            → +60
  - git push to main / origin/main → +90 (NEVER, per L7 §0.2)
  - git reset --hard            → +25 (unless to autoevo/pre-* tag)
  - rm  (plain)                  → +15
  - mv to system path (/etc, /usr) → +30
  - sed/awk -i (in-place edit)  → +10
- safe = score < 30
- `flags` lists each matched pattern with category

Tests cover: each pattern triggers, benign commands pass, threshold
boundaries, multi-flag commands, the no-force-push rule, the
autoevo/pre-tag exception for reset.

## Acceptance criteria
- [ ] `orchestrator/action_evaluator.py` exists with `evaluate_action`
- [ ] `tests/test_action_evaluator.py` has ≥ 8 tests, all green
- [ ] `pytest -q` full suite green
- [ ] `LEVEL.md` reports `S = 7` (5 active gates)
- [ ] `compute_level --check` exits 0 (S moves up, others unchanged)

## Files (closed set)
- `orchestrator/action_evaluator.py` (new)
- `tests/test_action_evaluator.py` (new)
- `cycles/20260512-051335/*`
- `BACKLOG.md`, `STATE.md`, `CHANGELOG.md`, `LEVEL.md`

## Forbidden
- secrets, hand-edit LEVEL, other production code

## Rollback
`git reset --hard autoevo/pre-20260512-051335`

## Risk score
low

## FAILURES.md pre-flight

Preflight flagged three matches via PLAN mention of existing gates:
- **FAIL-0001** (Reviewer TDD): "tdd" keyword from listing existing gates
- **FAIL-0002** (impossible-spec preflight): "preflight" likewise
- **FAIL-0003** (Guardian phantom-cost): "guardian" likewise

This cycle ADDS a sibling gate (action_evaluator); does not modify any
of the three cited gates. Same pattern as cycle 9 (S3 intake_sanitizer).

## Open questions
None.
