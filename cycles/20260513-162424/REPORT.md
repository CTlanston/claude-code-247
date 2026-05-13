# Cycle 20260513-162424 Report — Cycle 41 (empirically_reproduced field)

## Verdict

PASS — closes Cycle 33's surfaced M-dim discipline rule by
encoding it on disk. Every FAILURES.md entry now tags its
root-cause-confidence, so future cycles can grep for `no`-tagged
entries when deciding whether to verify before relying on a
prior fix. **First cycle this session to use
`Scheduler.record_cycle_success()` for the streak update**
(directive-compliant pattern).

Streak 21→22 (73% toward C-L5).

## Level changes

None (M at L7 max; this is evidence-tightening, not a level
move). C streak 21→22.

## Change

1. **`FAILURES.md` prologue** — new "Entry schema" section
   documenting all fields, with `**Empirically reproduced**:`
   prominently described. Allowed values:
   - `yes` — fix demonstrated + regression test
   - `no` — root cause inferred; future cycles MUST verify
   - `corrected_in_<cycle-id>` — was no, later corrected via
     empirical reproduction
   - `not_applicable` — tooling/environment issue

2. **11 entry tags** (one `**Empirically reproduced**:` line
   per entry, inserted after the `**Date**:` line):
   - FAIL-0001 / 0002 / 0003 / 0004 → `yes` (V4 hardening
     regression tests cover all four)
   - FAIL-0005 / 0006 / 0007 / 0008 / 0010 → `no` (fixes
     shipped without empirical reproducers; tagged so future
     cycles know to verify)
   - FAIL-0009 → `corrected_in_20260513-141046` (Cycle 33
     was the empirical reproducer; the "Corrected diagnosis"
     sub-block preserves the misattribution)
   - FAIL-0011 → `not_applicable` (mutmut tooling
     compatibility; not a system root cause)

3. **`tests/test_failures_integrity.py`** — +4 tests:
   - `test_prologue_documents_empirically_reproduced_field`
   - `test_every_entry_has_empirically_reproduced_field`
     (mandatory going forward — adding a new FAIL entry
     without the field will fail this test)
   - `test_empirically_reproduced_value_is_valid` (regex
     match on the leading token; allows free-form
     justification after)
   - `test_empirically_reproduced_breakdown_is_observable`
     (advisory — prints `{yes:4, no:5, corrected:1,
     not_applicable:1, missing:0}` to surface the ledger
     state without failing)

4. **`Scheduler.record_cycle_success("20260513-162424",
   deadlock=False)`** — new pattern for streak update.
   Previously cycles 33-40 manually wrote to
   `reports/zero-deadlock-streak.txt` AND appended to
   `reports/cycle-history.jsonl`. The Scheduler API does
   both atomically: streak file written, cycle entry
   appended with `ts` + `deadlock` + `streak_after`.

## Files modified

```
FAILURES.md                                     (+schema section, +11 tags)
tests/test_failures_integrity.py                (+4 tests, +helper)
CHANGELOG.md, BACKLOG.md, STATE.md
reports/zero-deadlock-streak.txt                (21→22 via Scheduler API)
reports/cycle-history.jsonl                     (+ entry via Scheduler API)
cycles/20260513-162424/*
```

## Verify

- `pytest tests/ -q`: 617 passed, 2 skipped, 0 failed
  (+4 integrity tests this cycle)
- `propose_next_track --for-cycle 20260513-162424` → proposal
  artifact written FIRST per Cycle 25 ordering rule
- `compute_level --check`: passed (Overall L=4 stable)
- `autodev_doctor.sh`: 14/0/2
- Empirical: `Scheduler().current_zero_deadlock_streak()` returns
  22 (verified before/after the call: 21 → 22)
- Advisory breakdown printed in the test output:
  `{'yes': 4, 'no': 5, 'not_applicable': 1, 'corrected': 1, 'missing': 0}`

## Constraints honored

- No `git push`. No PR merge. No secret touch.
- Append-only convention for FAILURES.md preserved — no
  existing text deleted; only additions (schema section in
  prologue + one line per entry).
- The 5 entries tagged `no` are explicitly acknowledged as
  needing future empirical verification. This is the
  procedural-debt visibility Cycle 33's lesson called for.
- 45-min budget: ~12 minutes for this cycle.

## Why mandatory (not advisory) on the field presence

The `test_every_entry_has_empirically_reproduced_field` test
makes the field MANDATORY going forward. Reasoning:
- Cycle 33's lesson was that an INFERRED root cause sat in
  the ledger for ~30 cycles before being verified, and the
  misattribution caused 7 of 8 cycles in this session to
  cite a wrong cause in their PLANs.
- The cost of an inferred root cause is high enough that the
  ledger should distinguish them from verified ones by
  construction, not by convention.
- The 4 allowed values are wide enough (yes/no/corrected/
  not_applicable) to cover every real situation; there's no
  scenario where "field missing" is the right answer.

If a future cycle adds a new FAIL entry without the field,
the test fails loudly. That's the right ergonomics.

## Discipline pattern reinforced

The pattern that emerged across cycles 33/38/39/40:
"runtime emission must not dirty the tracked tree."

Now Cycle 41 adds:
"every ledger entry must declare its root-cause-confidence."

These are both **structural disciplines** — invariants enforced
by tests, not policed by reviewer goodwill. Together they push
the M-dim work toward verifiable evidence rather than
unreviewed assumption.

## Next

Phase D continuation. C streak 22/30 → 8 more for C-L5.

Reasonable picks:
- Convert FAIL-0007 from `no` → `yes` via SQL migration +
  regression test (medium)
- Track P1 — Planner output contract validator
- Lint config (small)
- Other propose_next_track output

Watch context budget — handoff and exit at ~80%.

## Wall clock

~12 minutes.
