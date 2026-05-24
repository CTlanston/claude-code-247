# Cycle 20260513-163040 Report — Cycle 42 (prompt verify-rule)

## Verdict

PASS — completes the 3-cycle verify-before-relying discipline
thread. Streak 22→23 (77% to C-L5).

## Level changes

None (M at L7 max). C streak 22→23.

## Change

1. **`scripts/autodev_cycle_prompt.md`** — new sub-section under
   ORIENT, "Verify-before-relying on FAILURES entries (Cycle 42
   rule)", instructing every launchd-driven wake to check the
   `**Empirically reproduced**:` field on cited FAILURES entries:
   - `yes` → cite normally with disambiguation
   - `no` → MUST pick a different approach OR reproduce
     empirically in this cycle and update the entry
   - `corrected_in_<cycle-id>` → read the corrected-diagnosis
     sub-block; original root cause was wrong
   - `not_applicable` → cite normally

   The instruction is anchored to the FAIL-0009 misattribution
   pattern as the motivating example, so future readers
   understand why the rule exists.

2. **`tests/test_autodev_cycle_prompt.py`** — +1 structural
   test `test_prompt_documents_empirically_reproduced_check`
   pinning that the prompt:
   - references `empirically_reproduced` / `Empirically reproduced`
   - mentions "verify" + "rely" (or "verify-before-relying")
   - explains the `no` value means "inferred, not verified"

3. **Streak update via Scheduler API** (2nd cycle using the
   pattern). `Scheduler().record_cycle_success("20260513-163040",
   deadlock=False)` → streak 22 → 23, history entry appended.

## Files modified

```
scripts/autodev_cycle_prompt.md                 (+~25 lines)
tests/test_autodev_cycle_prompt.py              (+1 test, ~25 lines)
CHANGELOG.md, BACKLOG.md, STATE.md
reports/zero-deadlock-streak.txt                (22→23 via Scheduler)
reports/cycle-history.jsonl                     (+ entry via Scheduler)
cycles/20260513-163040/*
```

## Verify

- `pytest tests/ -q`: 618 passed, 2 skipped, 0 failed
- `pytest tests/test_autodev_cycle_prompt.py -q`: 28 passed
  (existing 27 + new 1)
- `propose_next_track --for-cycle 20260513-163040` → proposal
  artifact written FIRST per Cycle 25 ordering rule
- `compute_level --check`: passed
- `autodev_doctor.sh`: 14/0/2
- Scheduler.current_zero_deadlock_streak() returned 23 after
  record_cycle_success

## Constraints honored

- No `git push`. No PR merge. No secret touch.
- FAIL-0002 cited and disambiguated in PLAN preflight (the
  prompt edit's "preflight" keyword refers to
  scripts/preflight_failures.py, not orchestrator/preflight.py).
- The cycle does NOT modify FAILURES.md or
  orchestrator/preflight.py (Cycle 41's work / V4 code stay
  untouched).
- 45-min budget: ~8 minutes for this cycle.

## The verify-before-relying thread (now complete)

Three cycles, one principle:

| Cycle | Surface | Effect |
|---|---|---|
| 33 | FAIL-0009's "Corrected diagnosis" sub-block | The misattribution pattern surfaced + corrected |
| 41 | FAILURES.md schema + all 11 entries tagged | Schema invariant + ledger state |
| **42** | scripts/autodev_cycle_prompt.md ORIENT step | Every wake checks the tag on cited entries |

A wake-cycle that cites a `no`-tagged FAILURES entry in its
PLAN preflight will now KNOW the root cause was inferred and
must either route around it or do empirical verification.
Cycle 33's lesson is now operational discipline, not
documentation.

## Next

C streak 23/30 → 7 more for C-L5 → Overall 5.

Reasonable picks:
- Convert FAIL-0007 from `no` → `yes` (SQL migration; medium)
- Track P1 — Planner contract validator (medium)
- Lint config (small)
- Other propose_next_track output

Watch context budget — handoff and exit at ~80%.

## Wall clock

~8 minutes.
