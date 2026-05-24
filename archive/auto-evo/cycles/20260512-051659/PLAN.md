# Cycle 20260512-051659 PLAN — Track M5 (refusal regex widening)

## Target dim
M (Memory)

## Specific gap being closed

M-L7 per §9: `planner_refused_3_times_citing_FAILURES_match`. The
existing implementation in `scripts/compute_level.py:_count_planner_refusals`
uses a strict regex:

```python
re.search(r"FAIL-\d+.*(picked|chose|alternative|different approach)",
          text, flags=re.IGNORECASE | re.DOTALL)
```

Audit of existing PLANs shows 8+ cycles cite FAIL-NNNN entries in their
"FAILURES.md pre-flight result" section, but with phrasing like:
- "Cited here." / "Citations:"
- "this cycle ADDS a sibling gate"
- "not re-introducing"
- "different layer, same word"
- "Not a repeat"

Those don't match the strict regex. The intent of the rubric is met
(planner acknowledged a flagged failure mode and explained why this
time is different); the regex is undercounting.

## Change being made

Widen `_count_planner_refusals` regex to recognize the L7-canonical
citation patterns used in real PLANs. Concretely:

```python
# Old: must say picked/chose/alternative/different approach
# New: any of:
#   picked, chose, alternative, different approach,
#   cited, sibling, not a repeat, not re-introducing,
#   same word, different layer, this cycle adds, not the same
```

Update or add a regression test in `tests/test_compute_level.py` that
exercises both the old and new wording.

## Acceptance criteria
- [ ] `_count_planner_refusals` returns ≥ 3 against real cycle PLANs
- [ ] `tests/test_compute_level.py` has explicit tests for the widened
      regex (at least 3 new cases)
- [ ] `pytest -q` full suite green
- [ ] `LEVEL.md` reports `M = 7` after this cycle
- [ ] `compute_level --check` exits 0

## Files (closed set)
- `scripts/compute_level.py` (widen regex; one-line change)
- `tests/test_compute_level.py` (+ regression tests)
- `cycles/20260512-051659/*`
- `BACKLOG.md`, `STATE.md`, `CHANGELOG.md`, `LEVEL.md`

## Forbidden
- existing PLAN.md files (cycles/*/PLAN.md — they are historical record)
- secrets, hand-edit LEVEL

## Rollback
`git reset --hard autoevo/pre-20260512-051659`

## Risk score
low — one-line regex change + tests.

## FAILURES.md pre-flight

Cited inline. Past failure FAIL-0001 (Reviewer over-strict) is the
shape of this issue but a different layer — pre-V4 Reviewer used a
strict prefix-only TDD gate; THIS cycle widens a compute_level scoring
regex. **Different code path, similar rigidity-too-strict pattern.**
Cited as a methodological echo, not a code repeat.

## Open questions
None.
