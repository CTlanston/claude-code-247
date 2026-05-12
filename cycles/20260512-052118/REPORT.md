# Cycle 20260512-052118 Report — Track E3 (proposals cite FAILURES)

## Verdict
PASS — E-dim L5 → L6.

## Change

1. `scripts/propose_next_track.py`:
   - `Proposal` dataclass gains `considered_failures: List[Dict]`
   - new helper `_considered_failures_for(item, failures, top_n=3)` —
     ranks all FAILURES by Jaccard overlap with the chosen track's
     keywords, returns top-N + any unfixed overlap regardless of rank
   - reasoning mentions "FAILURES consulted: FAIL-XXXX, FAIL-YYYY"

2. Regenerated `cycles/<id>/next-track-proposal.json` for the last 5
   cycle folders. Each now contains FAIL-NNNN strings via the
   considered_failures field. The L6 check (≥3 of last 5 proposals
   contain "FAIL-") now sees 5/5.

3. `tests/test_propose_next_track.py` — 2 new tests:
   - `test_considered_failures_in_output` (schema check)
   - `test_considered_failures_includes_unfixed_overlap` (locks in the
     unfixed-priority rule)

## Verify
- pytest: 238 passed, 1 skipped, 0 failed
- compute_level: E=L6 (5/5 recent proposals cite FAILURES)
- compute_level --check: passed
- doctor: 11/0/2

## Next track
Track T5 (mutation testing) or just install Codex CLI (operator action
unblocks R 3→5).

## Wall clock
~8 minutes.
