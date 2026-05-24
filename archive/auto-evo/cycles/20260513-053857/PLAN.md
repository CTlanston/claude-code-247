# Cycle 20260513-053857 PLAN — Phase D Cycle 32 (Track K1: Wave 1 skills)

## Target dimension

aux (no rubric dim move; supports all tracks per BACKLOG K1 entry).
Phase D first opportunistic cycle. C-streak bump only (12→13).

## Specific gap being closed

BACKLOG Track K1 says: ".claude/skills/ directory + minimal Wave 1
SKILL.md files. matt.diagnose, matt.tdd, matt.to-issues,
matt.improve-codebase-architecture, matt.grill-with-docs. Each is
a single .md file, no external dependencies."

These are stub Skill files that the orchestrator's `skill_router`
(future Track K2) will eventually classify against. Each file
documents the skill's purpose, when to invoke, and what it does
NOT do. Pure-add docs; zero risk.

## Change being made

1. Create `.claude/skills/` directory (already done).

2. Add 5 SKILL.md files:
   - `matt.diagnose.md` — diagnose mode (per §7 Diagnose contract
     + §11 state machine). When 2× CI fail / 2× Reviewer reject /
     repeat error signature, this skill is invoked to reproduce,
     minimize, hypothesize, fix.
   - `matt.tdd.md` — strict TDD discipline. Test first, watch fail,
     impl minimum, watch pass.
   - `matt.to-issues.md` — turning vague tasks into well-formed
     GitHub issues.
   - `matt.improve-codebase-architecture.md` — refactor mode.
     Identify code smells; propose smallest-vertical-slice
     improvement; cite ADR.
   - `matt.grill-with-docs.md` — read-heavy verification mode.
     When changes touch a contract, verify against the doc.

3. Add `tests/test_wave1_skills.py` — structural tests pinning
   each file's existence + required sections (purpose, when to
   invoke, what NOT to do, exit criteria).

## Acceptance criteria

- [x] All 5 SKILL.md files in `.claude/skills/` exist
- [x] `tests/test_wave1_skills.py` ≥10 tests
- [x] `pytest tests/ -q` green
- [x] `compute_level --check` green (after propose-first)
- [x] `autodev_doctor.sh`: 13/0/2

## Files to touch (closed set)

- `.claude/skills/matt.diagnose.md` (new)
- `.claude/skills/matt.tdd.md` (new)
- `.claude/skills/matt.to-issues.md` (new)
- `.claude/skills/matt.improve-codebase-architecture.md` (new)
- `.claude/skills/matt.grill-with-docs.md` (new)
- `tests/test_wave1_skills.py` (new)
- `CHANGELOG.md` (one line)
- `BACKLOG.md` (mark K1 done)
- `STATE.md` (rewrite)
- `cycles/20260513-053857/PLAN.md` (this)
- `cycles/20260513-053857/REPORT.md`
- `cycles/20260513-053857/RESULT.md`
- `cycles/20260513-053857/next-track-proposal.json`
- `reports/zero-deadlock-streak.txt` (12→13)
- `reports/cycle-history.jsonl` (append)

## Files forbidden to touch

- `.env*`, `secrets/**`, `LEVEL.md`, anything in §0.

## Rollback plan

`git reset --hard autoevo/pre-20260513-053857`. Pure-add docs.

## Risk score

low. 5 small .md files + a structural test file.

## FAILURES.md pre-flight result

Keywords: skill, diagnose, tdd, issues, architecture, grill, docs.

- **FAIL-0001** matched on `tdd` + `reviewer`. **Cited and
  disambiguated**: FAIL-0001 is about the Reviewer rejecting a
  TDD-compliant PR for trailing edge-case tests (the strict
  prefix-only commit-order gate). The fix shipped in V4 commit
  110e7bd as `_check_tdd_invariant` intent detection.
  This cycle adds a stub SKILL.md describing the TDD discipline
  CONCEPT for future skill-router classification. **No code
  change to `_check_tdd_invariant` or any Reviewer role prompt.**
  Different layer (skill metadata, not gate code); not a repeat.
- No other FAILURES.md matches.

## Open questions / blockers

None.
