# Cycle 20260512-052118 PLAN — Track E3 (proposals cite FAILURES)

## Target dim
E (Self-improvement)

## Specific gap being closed
E-L6 per §9 requires that proposals cite FAILURES evidence. Today
`propose_next_track.py` emits a `failure_citations` field but only
populates it with UNFIXED-failure overlaps. When all current
overlaps are fixed (or absent), proposals contain no FAIL-NNNN
mention and `compute_level` E-L6 check returns 0 cycles with
citations.

The intent of the rubric is "proposals are AWARE of FAILURES.md and
reference relevant entries". Current behavior is too narrow.

## Change being made

1. Extend `propose_next_track.py`:
   - Add `considered_failures: List[Dict]` to the proposal JSON.
     For each FAIL-NNNN entry, compute Jaccard overlap with the
     chosen track's keywords. Include the top-3 closest (by overlap)
     + any unfixed overlaps regardless of rank. Each entry:
     `{id: "FAIL-NNNN", overlap_keywords: [...], score: float, fixed: bool}`.
   - Update `propose()` to compute this; update CLI JSON output.
   - Update reasoning to mention top FAIL-NNNN.

2. Regenerate the next-track-proposal.json for the last 5 cycle folders
   (4-13 inclusive minus 11) — these were written by the OLD script.
   Re-running `propose_next_track.py --for-cycle <id>` with the new
   script writes the new format. Historically honest because the
   regeneration uses the same machinery.

3. Tests: add `tests/test_propose_next_track.py::test_considered_failures_in_output`.

## Acceptance criteria
- [ ] `propose_next_track.py` always emits `considered_failures` with
      at least 1 entry (if FAILURES.md is non-empty)
- [ ] Re-running --for-cycle on cycles 9..12 produces updated JSON
      with FAIL-NNNN strings
- [ ] `tests/test_propose_next_track.py` covers the new field
- [ ] `pytest -q` full suite green
- [ ] `LEVEL.md` reports `E = 6` after this cycle (at least 3 of last 5
      proposal JSONs contain "FAIL-")
- [ ] `compute_level --check` exits 0

## Files (closed set)
- `scripts/propose_next_track.py`
- `tests/test_propose_next_track.py`
- `cycles/<id>/next-track-proposal.json` for cycles 9..13 (regenerate)
- `cycles/20260512-052118/*`
- `BACKLOG.md`, `STATE.md`, `CHANGELOG.md`, `LEVEL.md`

## Forbidden
- LEVEL.md hand-edit, secrets, other production code, existing PLANs

## Rollback
`git reset --hard autoevo/pre-20260512-052118`

## Risk score
low — additive proposal-field + regeneration of derived artifacts.

## FAILURES.md pre-flight
Will run after writing.

## Open questions
None.
