# Cycle 20260513-162424 PLAN — Cycle 41 (empirically_reproduced field)

## Target dimension

M (Memory). M is at L7 max; this is an evidence-tightening
cycle, not a level move. Streak bump only (21→22).

## Specific gap being closed

Cycle 33 surfaced a procedural M-dim discipline rule (encoded
in FAIL-0009's Corrected diagnosis sub-block):

> Every FAILURES.md entry whose root cause was inferred rather
> than empirically reproduced should be tagged so future cycles
> know to verify before relying on it.

Surfacing the rule was Cycle 33's job; encoding it in disk state
is this cycle's job. Without explicit tagging, every entry's
root-cause-confidence is opaque to a wake-cycle reader.

## Change being made

1. **`FAILURES.md` prologue** — extend with a new schema field:

   `empirically_reproduced: yes | no | corrected_in_<cycle-id> | not_applicable`

   Meaning:
   - `yes` — the working fix was demonstrated to resolve the
     symptom AND a regression test that exercises the fix is
     committed.
   - `no` — the root cause is inferred from logs / reasoning /
     analogy; no empirical reproducer was run, so future cycles
     should verify before relying on this entry's root cause.
   - `corrected_in_<cycle-id>` — was `no`, but a later cycle
     reproduced empirically and either confirmed or corrected
     the root cause via an appended "Corrected diagnosis"
     sub-block. (Currently only FAIL-0009.)
   - `not_applicable` — the entry is a tooling / environment
     issue where empirical reproduction isn't meaningful (e.g.
     FAIL-0011 mutmut tooling).

2. **Tag each of the 11 existing entries** with the new field
   immediately after its `**Date**:` line. Mechanical
   classification from the existing `**Regression test**:` text:
   - has tests/test_*.py cited → `yes` (FAIL-0001, 0002, 0003, 0004)
   - "not yet" → `no` (FAIL-0005, 0006, 0007, 0008, 0010)
   - has Corrected diagnosis sub-block from Cycle 33 →
     `corrected_in_20260513-141046` (FAIL-0009)
   - "not applicable" → `not_applicable` (FAIL-0011)

3. **`tests/test_failures_integrity.py`** — extend with:
   - A test that every entry has the field (mandatory going
     forward).
   - A test that the field value is one of the allowed values.
   - An advisory test that prints the breakdown (yes / no /
     corrected / not_applicable counts) — informational only,
     never fails.

4. **`reports/zero-deadlock-streak.txt` + cycle-history.jsonl**
   updated via **`Scheduler.record_cycle_success()`** instead of
   the manual file-write pattern. (New session directive.)

## Acceptance criteria

- [x] FAILURES.md prologue documents the field + 4 valid values
- [x] All 11 existing FAIL entries tagged
- [x] `tests/test_failures_integrity.py` requires the field on
      every entry + accepts only the 4 valid values
- [x] An advisory breakdown test prints counts
- [x] `pytest tests/ -q` green (no regressions; new tests pass)
- [x] `compute_level --check` green (after propose-first)
- [x] `Scheduler.record_cycle_success()` used for streak (NEW
      pattern; replaces the manual file-write idiom)
- [x] streak 21→22 reflected in `reports/zero-deadlock-streak.txt`
      via the scheduler call

## Files to touch (closed set)

- `FAILURES.md` (prologue extension + 11 entry tags)
- `tests/test_failures_integrity.py` (extend)
- `CHANGELOG.md` (one line)
- `BACKLOG.md` (mark new track done)
- `STATE.md` (rewrite)
- `cycles/20260513-162424/PLAN.md` (this)
- `cycles/20260513-162424/REPORT.md`
- `cycles/20260513-162424/RESULT.md`
- `cycles/20260513-162424/next-track-proposal.json`
- `reports/zero-deadlock-streak.txt` (via Scheduler API)
- `reports/cycle-history.jsonl` (via Scheduler API)

## Files forbidden to touch

- `.env*`, `secrets/**`, `LEVEL.md`, anything in §0.

## Rollback plan

`git reset --hard autoevo/pre-20260513-162424`. The change is
text-additive in FAILURES.md (preserves the append-only
contract: no existing text deleted, just one line added per
entry) + extends an existing test file.

## Risk score

low. Pure metadata work. The integrity test addition makes the
new field mandatory going forward but doesn't break existing
tests.

## FAILURES.md pre-flight result

Keywords: FAILURES, empirically_reproduced, root cause, ledger,
discipline, M-dim.

- No FAILURES.md matches.
- This cycle was surfaced AS a discipline rule in Cycle 33;
  it's the natural follow-up.

## Open questions / blockers

None.
