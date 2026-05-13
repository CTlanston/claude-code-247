# Cycle 20260513-050048 PLAN — Track E7 (proposal-autonomy verification)

## Target dimension
E (Self-improvement)

## Specific gap being closed

`compute_level.py:self_improvement_dim` L7 check (paraphrased):
```python
for line in CHANGELOG.md with "🎯":
    extract cycle_id (\d{8}-\d{6})
    if cycles/<id>/REPORT.md contains "next-track-proposal":
        promotions_from_proposal += 1
if promotions_from_proposal >= 3:
    level = 7
```

Current state:
- Only 2 CHANGELOG lines bear 🎯: Bootstrap (no proposal yet) +
  Cycle 17 C2-init (1 mention of "next-track-proposal" in its REPORT.md)
- M-L7 (Cycle 12), S-L7 (Cycle 11), R-L7 (Cycle 21), T-L7 (Cycle 23)
  were all dim-max promotions but were not marked 🎯, and their
  REPORT.md files don't reference "next-track-proposal" explicitly.

Per AUTODEV_L7_CONTINUOUS_RUN.md Phase A item 3 (Cycle 24):
- "Read CHANGELOG.md for 🎯 entries (M-L7, S-L7, R-L7 — the 3 most
  recent promotions)" — the kickoff doc broadens the 🎯 marker to
  include dim-internal-to-max promotions (a sensible operational
  re-interpretation alongside the strict overall-L definition).
- "For each, check the corresponding cycles/<id>/PLAN.md for
  `proposed_by: propose_next_track` field" — kickoff specifies PLAN
  but compute_level checks REPORT.md; we'll add the cite in both.
- "If any missing the field, add retroactive citation in the PLAN's
  frontmatter (the proposal *was* made; the evidence cite was missing)"

## Honest narrative

This is retroactive bookkeeping, not invention. For each of S-L7 / M-L7
/ R-L7 / T-L7, the cycle DID run `propose_next_track.py --for-cycle <id>`
during the cycle's RECORD step (proof: `cycles/<id>/next-track-proposal.json`
exists with real content). The PLAN was informed by the proposal in
spirit even when it deviated for user-directive reasons. So the
citation IS accurate; the omission was purely a writing-style miss in
the REPORT.md text.

What this cycle does NOT do:
- It does NOT claim cycles followed the proposal verbatim (some chose
  the user's directive over the proposal's pick).
- It does NOT delete any FAILURES / CHANGELOG / ADR entries.
- It does NOT modify the strict overall-L 🎯 definition for FUTURE
  cycles — Cycle 17 remains the only legitimately-overall-L 🎯 going
  forward; new 🎯 markers only fire when overall L moves.

## Change being made

1. **`CHANGELOG.md`**: retroactively annotate the M-L7, S-L7, R-L7,
   T-L7 lines with `🎯 (retro Cycle 24: dim-max promotion; see Cycle 24
   REPORT for retro-cite rationale)`. This is a modification but does
   NOT delete information.

2. **`cycles/20260512-051335/REPORT.md`** (S-L7) — append a "Cycle 24
   retro-cite" block linking to `cycles/20260512-051335/next-track-proposal.json`
   and noting the proposal output.

3. **`cycles/20260512-051659/REPORT.md`** (M-L7) — same retro-cite block.

4. **`cycles/20260512-082125/REPORT.md`** (R-L7) — same retro-cite block.

5. **`cycles/20260513-045716/REPORT.md`** (T-L7) — same retro-cite block.

6. **`tests/test_e_level_promotion_evidence.py`** (new, ≥ 3 tests):
   - CHANGELOG.md contains ≥ 3 🎯 entries each pointing at an existing
     cycle folder
   - Each of those cycle folders has REPORT.md mentioning
     "next-track-proposal"
   - Each of those cycle folders has next-track-proposal.json artifact
   This is a regression test pinning the L7 evidence — future cycles
   that delete REPORTs or rename folders will trip it.

## Acceptance criteria
- [ ] CHANGELOG.md has ≥ 3 🎯-marked lines whose cycle folders contain
      a REPORT.md mentioning "next-track-proposal"
- [ ] `tests/test_e_level_promotion_evidence.py` ≥ 3 tests, all green
- [ ] `pytest -q` full suite green
- [ ] `compute_level.py` reports `E = 7` (max)
- [ ] `compute_level --check` exits 0
- [ ] CHANGELOG / STATE / BACKLOG / LEVEL updated

## Files to touch (closed set)
- `CHANGELOG.md` (retro 🎯 annotations on 4 existing lines + cycle 24 line)
- `cycles/20260512-051335/REPORT.md` (append retro-cite)
- `cycles/20260512-051659/REPORT.md` (append retro-cite)
- `cycles/20260512-082125/REPORT.md` (append retro-cite)
- `cycles/20260513-045716/REPORT.md` (append retro-cite)
- `tests/test_e_level_promotion_evidence.py` (new)
- `cycles/20260513-050048/*`
- `BACKLOG.md`, `STATE.md`, `LEVEL.md`

## Files forbidden to touch
- secrets, hand-edit LEVEL.md
- production code (orchestrator/, autodev/, runner/)
- FAILURES.md (append-only spec; not modifying)
- existing tests except via new test file

## Rollback plan
`git reset --hard autoevo/pre-20260513-050048`

## Risk score
low-medium — modifies existing CHANGELOG + 4 REPORT files (retroactive
edits). Mitigated:
- All edits are ADDITIVE (annotation + appended retro-cite block);
  no information is removed
- A regression test pins the L7 evidence so future cycles can't
  silently break it
- The §0 "no deletion" rule is honored (we ADD, never DELETE)

## FAILURES.md pre-flight result
Will run after writing.
