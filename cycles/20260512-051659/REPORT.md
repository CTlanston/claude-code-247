# Cycle 20260512-051659 Report — Track M5 (refusal-regex)

## Verdict
PASS — M-dim L6 → L7 (max).

## Change

Widened `scripts/compute_level.py:_count_planner_refusals` regex to
recognise the citation language real cycles have been using:

- legacy: `picked | chose | alternative | different approach`
- new: `cited`, `sibling (failure|gate|to)`, `not (a )?(repeat |
  re-introducing | the same)`, `different (layer|code path|system|
  subscription)`, `this cycle (adds|is about|tests)`

Audit before: 0 refusals counted (despite 8+ cycle PLANs citing
FAIL-NNNN with the L7-canonical wording). After: 7 refusals counted.

5 new regression tests in `tests/test_compute_level.py`:
- legacy "picked" phrase counts
- new "cited" phrase counts
- new "sibling" phrase counts
- bare FAIL-NNNN mention without citation context does NOT count
- real-repo refusal count is ≥ 3

## Verify
- pytest: 236 passed, 1 skipped, 0 failed
- compute_level: M=L7 (Planner refused 7 times citing FAILURES)
- compute_level --check: passed
- doctor: 11/0/2

## Next track
Track T5 — mutation testing with mutmut on V4 modules → T 4→5.

## Wall clock
~7 minutes.
