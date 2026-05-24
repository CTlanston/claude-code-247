# Cycle 20260513-053023 PLAN — Phase C Cycle 30 (handoff doc)

## Target dimension

DOC (no rubric dim move). Phase C step 1 of 2. Deliverable is
`reports/L7-handoff-to-launchd.md` — the operator's one-stop
reference for taking over the system once this session ends.

## Specific gap being closed

Phase A + B are complete. The launchd 7×24 infrastructure exists
on disk. But there's no single doc the operator can read to:
- Understand what runs 24/7 after install
- Find the right install command
- Monitor the system without grovelling through 8 files
- Pause / resume / stop
- Inspect failures
- Know when to come back manually

The kickoff doc §C Cycle 30 enumerates 10 sections; this cycle
implements all of them with the correct script paths from
Phase B (note: `install_launchd_continuous.sh`, not the v3
`install_launchd_autodev.sh`).

## Change being made

1. Create `reports/L7-handoff-to-launchd.md` — comprehensive
   operator handoff. 10 sections per kickoff §C:

   1. What runs 24/7 after install (the wake script's stop checks
      → claude -p → §4 cycle protocol → atomic commit → exit 0)
   2. How to install (`bash scripts/install_launchd_continuous.sh --install`)
   3. How to monitor (`bash scripts/autodev_status_dashboard.sh`)
   4. How to pause (`touch reports/STOPSWITCH`; current cycle
      completes then no more dispatch)
   5. How to resume (`rm reports/STOPSWITCH`)
   6. How to fully stop (`bash scripts/install_launchd_continuous.sh --uninstall`)
   7. How to inspect failures (`tail reports/runs/launchd.err.log`,
      `tail reports/runs/<ts>.log`)
   8. What "done" looks like (`cat reports/AUTODEV_DONE.md`)
   9. Cost monitoring (`tail reports/codex-spend.jsonl`; OpenAI
      dashboard weekly)
   10. When to come back manually:
       - BLOCKED.md exists
       - ALERT.md exists (Codex disagreement)
       - Overall L stuck at same value for > 5 days (system
         needs new tracks)

   Plus three additional sections for completeness:
   - **Quick reference card** (top of doc) — the 5 most-common
     operator commands
   - **Architecture overview** (mid-doc) — diagram of the
     launchd → wake script → prompt → cycle → exit 0 flow
   - **FAQ** (bottom) — answers to "why is it still running",
     "did my install work", "how do I see what cycle was last
     dispatched", "what if AUTODEV_DONE appears", "what if I
     want to raise the target L"

2. Add `tests/test_l7_handoff_doc.py` — structural tests that
   the doc exists + all 10 required sections + correct script
   paths cited + the QUICK REFERENCE block exists.

## Acceptance criteria

- [x] `reports/L7-handoff-to-launchd.md` exists
- [x] `tests/test_l7_handoff_doc.py` ≥10 structural tests
- [x] `pytest tests/ -q` green
- [x] `compute_level --check` green (propose-first)
- [x] `autodev_doctor.sh`: 13/0/2

## Files to touch (closed set)

- `reports/L7-handoff-to-launchd.md` (new)
- `tests/test_l7_handoff_doc.py` (new)
- `CHANGELOG.md` (one line)
- `BACKLOG.md` (mark Cycle 30 done, surface Cycle 31 P0)
- `STATE.md` (rewrite)
- `cycles/20260513-053023/PLAN.md` (this)
- `cycles/20260513-053023/REPORT.md`
- `cycles/20260513-053023/RESULT.md`
- `cycles/20260513-053023/next-track-proposal.json`
- `reports/zero-deadlock-streak.txt` (bump 10→11)
- `reports/cycle-history.jsonl` (append)

## Files forbidden to touch

- `.env*`, `secrets/**`, `LEVEL.md` (computed), anything in §0.

## Rollback plan

`git reset --hard autoevo/pre-20260513-053023` is the fallback.
Pure-add doc + tests. No risk.

## Risk score

low. Documentation cycle.

## FAILURES.md pre-flight result

Keywords: handoff, launchd, install, monitor, pause, resume,
inspect, done, cost.

- No FAILURES.md matches.

## Open questions / blockers

None.
