# Cycle 20260512-044832 PLAN — Track E2 (propose_next_track.py)

## Target dimension
E (Self-improvement)

## Specific gap being closed
Per L7 §3 rubric and §9 logic, E-dim L4 requires
`scripts/propose_next_track.py` to exist. Today the script is absent;
track selection is "manual mode" (the operator / current cycle author
reads BACKLOG.md and picks a P0). The compute_level scorer reports
E = L3 specifically because of this gap. Implementing the script lifts
E from L3 to L4.

## Change being made

Build `scripts/propose_next_track.py`:

- Read LEVEL.md to learn current per-dim levels
- Read FAILURES.md (via the existing `preflight_failures.parse_failures`
  helper) to know prior failure patterns
- Read BACKLOG.md to enumerate open P0/P1/P2 tracks
- Score each open track by:
  - Rubric impact: does completing the track lift a dim's level?
  - Floor preference: prefer tracks that lift the lowest-level dim
  - Cost preference: prefer tracks marked "P0" / "P1"
  - Safety: avoid tracks whose description keywords overlap with
    UNFIXED FAILURES (i.e. ones whose "Working fix" says "NOT YET
    SHIPPED" or "planned")
- Emit a JSON proposal listing:
  - Chosen track (id, title, dim, priority, estimated impact)
  - Top 3 ranked alternatives with scores
  - Failure citations consulted
  - Reasoning string

Write the proposal to `cycles/<NEXT_CYCLE_ID>/next-track-proposal.json`
when invoked with `--for-cycle <CYCLE_ID>`; or print to stdout when
invoked without that flag.

Add `tests/test_propose_next_track.py` with >= 8 tests covering: parsing
each input, scoring rules, floor preference, fallback when BACKLOG is
empty, JSON output shape, the "avoid unfixed failures" rule, and CLI
flags.

## Acceptance criteria
- [ ] `scripts/propose_next_track.py` exists; is executable
- [ ] `tests/test_propose_next_track.py` has >= 8 tests, all green
- [ ] `pytest -q` green; no existing test regresses
- [ ] `scripts/compute_level.py` reports `E = 4` after this cycle
- [ ] `scripts/compute_level.py --check` does not regress any other dim
- [ ] `./scripts/autodev_doctor.sh` exits 0 (warns allowed)
- [ ] `scripts/preflight_failures.py --strict` passes on this PLAN
      (any matches cited)
- [ ] Smoke test: running the new script against the real repo emits
      a valid JSON with a sensible "chosen" track from BACKLOG.md

## Files to touch (closed set)
- `scripts/propose_next_track.py` (new)
- `tests/test_propose_next_track.py` (new)
- `cycles/20260512-044832/PLAN.md` (this)
- `cycles/20260512-044832/RESULT.md` (new)
- `cycles/20260512-044832/REPORT.md` (new)
- `cycles/20260512-044832/STATE.before.md` (snapshot)
- `cycles/20260512-044832/verify-output.txt` (new)
- `BACKLOG.md` (mark E2 DONE; next P0 may be T2 or H1)
- `STATE.md` (rewrite)
- `CHANGELOG.md` (append line)
- `LEVEL.md` (regenerate; E should move 3 → 4)

## Files forbidden to touch
- `.env*`, `secrets/**`, `*.key`, `*.pem`, `id_rsa*`
- `LEVEL.md` by hand
- `orchestrator/**`, `autodev/**`, `runner/**` (no production code)
- existing tests
- existing ADRs / FAILURES.md (append-only)

## Rollback plan
`git reset --hard autoevo/pre-20260512-044832`

## Risk score
low — new script + new test file, pure tooling. No production code. The
script does not mutate state by default — it only emits a proposal that
future cycles can choose to honor.

## FAILURES.md pre-flight result

Run `scripts/preflight_failures.py --plan <this> --failures FAILURES.md
--strict` after writing this; address any matches inline.

## Open questions / blockers
None.
