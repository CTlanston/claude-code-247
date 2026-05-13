# Cycle 20260513-051327 PLAN — Phase B Cycle 26 (autodev_cycle_prompt.md)

## Target dimension

INFRA (no dim move). This is Phase B step 2 of the launchd-driven 7×24
infrastructure stack. No rubric move expected; the deliverable is the
text file `scripts/autodev_cycle_prompt.md` that `claude -p` reads on
every launchd wake, plus a structural test that locks in the required
sections so future edits can't silently break headless mode.

## Specific gap being closed

`scripts/autodev_continuous_cycle.sh` (Cycle 25) shell-execs
`claude -p "$(cat scripts/autodev_cycle_prompt.md)" ...` on every
wake. Without that prompt file, launchd would hand `claude` an empty
directive and the cycle would no-op. This cycle ships the file.

## Change being made

1. Create `scripts/autodev_cycle_prompt.md` — the standing instruction
   the launchd-driven `claude -p` reads on every wake. Self-contained,
   one cycle, exits. Mirrors the spec in
   `AUTODEV_L7_CONTINUOUS_RUN.md` Cycle 26 §, plus encodes the
   procedural lesson from Cycle 25 (run
   `propose_next_track --for-cycle <id>` BEFORE
   `compute_level --check` during RECORD so the last-5-cycles E
   window doesn't transiently regress).

2. Add `tests/test_autodev_cycle_prompt.py` — structural tests that
   the file exists, contains the required ORIENT/DECISIONS/ACT/
   CONSTRAINTS/C-DIM-HANDLING/RECORD-step-ordering sections,
   mentions the 45-min budget, references §0/§13/§16 of the master
   prompt, and contains NO interactive language ("ask the human",
   "wait for confirmation", "what would you like me to do").

## Acceptance criteria

- [x] `scripts/autodev_cycle_prompt.md` exists with all 6 sections
- [x] `tests/test_autodev_cycle_prompt.py` adds ≥10 structural tests
- [x] `pytest -q` green (all prior tests + new ones pass)
- [x] `scripts/compute_level.py --check` finds no regression in any
      other dim (run AFTER `propose_next_track --for-cycle` per the
      Cycle 25 procedural lesson)
- [x] `scripts/autodev_doctor.sh` exits 0 (still 12 checks)

## Files to touch (closed set)

- `scripts/autodev_cycle_prompt.md` (new)
- `tests/test_autodev_cycle_prompt.py` (new)
- `CHANGELOG.md` (one append-only line)
- `BACKLOG.md` (mark Cycle 26 done, surface Cycle 27 P0)
- `STATE.md` (rewrite per cycle convention)
- `cycles/20260513-051327/PLAN.md` (this file)
- `cycles/20260513-051327/REPORT.md` (RECORD step)
- `cycles/20260513-051327/RESULT.md` (PASS/FAIL_AS_DATA/TIMEOUT)
- `cycles/20260513-051327/next-track-proposal.json` (run BEFORE
  --check per Cycle 25 lesson)
- `reports/zero-deadlock-streak.txt` (bump 6→7 if no deadlock)
- `reports/cycle-history.jsonl` (append)

## Files forbidden to touch

- `.env*`, `secrets/**`, `LEVEL.md` (computed only), anything in §0
  hard-constraint scope.

## Rollback plan

`git reset --hard autoevo/pre-20260513-051327` is always the fallback.
This is a pure-add cycle (prompt + tests); no risk to existing code.

## Risk score

low. Pure-add of a text file + structural tests. No production code
touched.

## FAILURES.md pre-flight result

Keywords from this PLAN: prompt, cycle, propose, compute_level, check,
RECORD, ordering, launchd, headless.

- **FAIL-0009** (doctor session-log side-effect): not relevant — this
  cycle doesn't run `autodev_doctor.sh` as code; it cites it in the
  prompt only.
- **FAIL-0011** (mutmut tooling): not relevant.
- No other matches.

The Cycle 25 procedural lesson (propose-before-check) is encoded
into the new prompt as a "RECORD step ordering" rule so any future
launchd-driven wake follows it.

## Open questions / blockers

None.
