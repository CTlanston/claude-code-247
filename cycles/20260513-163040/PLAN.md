# Cycle 20260513-163040 PLAN — Cycle 42 (prompt verify rule)

## Target dimension

M (Memory). M at L7 max; this completes the discipline-rule
thread (Cycle 33 surfaced, Cycle 41 encoded in FAILURES.md,
Cycle 42 encodes in the cycle prompt's ORIENT step). No level
move. Streak 22→23.

## Specific gap being closed

Cycle 41 added the `empirically_reproduced` field to all 11
FAILURES.md entries. But the cycle prompt
(`scripts/autodev_cycle_prompt.md`) doesn't tell a launchd-driven
wake to actually check it. Wake-cycles cite FAILURES entries in
their PLAN preflight (per Cycle 25's procedural rule), but
they don't yet treat a `no`-tagged entry differently from a
`yes`-tagged one.

This cycle adds one ORIENT-step instruction: when a PLAN's
preflight cites a FAILURES entry tagged `empirically_reproduced:
no`, the PLAN must EITHER pick a different approach OR verify
the inferred root cause empirically before relying on it.

## Change being made

1. **`scripts/autodev_cycle_prompt.md`** ORIENT section
   (+ ~10-line block):
   ```markdown
   ### Verify-before-relying on FAILURES entries

   Every FAILURES.md entry carries an `**Empirically reproduced**:`
   field (added in Cycle 41). When this cycle's PLAN preflight
   cites a FAIL-NNNN entry, check that field. If the value is:

   - `yes` — the entry has a regression test; cite normally with
     "different layer / different system / not a repeat".
   - `no` — the root cause is INFERRED, not verified. The cycle
     must either:
     (a) pick a different approach so the inferred cause isn't
         load-bearing, OR
     (b) empirically reproduce the failure as part of THIS cycle
         and either confirm (yes) or correct
         (corrected_in_<this-cycle-id>) the entry before relying.
   - `corrected_in_<cycle-id>` — read the corrected diagnosis
     sub-block. The original root cause was wrong; cite the
     corrected one.
   - `not_applicable` — tooling/environment issue; cite normally.
   ```

2. **`tests/test_autodev_cycle_prompt.py`** (+1 test):
   - New: `test_prompt_documents_empirically_reproduced_check`
     — verify the prompt's ORIENT section contains the verify-
     before-relying language and references the field name.

3. **Streak update via `Scheduler.record_cycle_success()`**
   (the new pattern from Cycle 41).

## Acceptance criteria

- [x] Cycle-prompt ORIENT section contains the
      verify-before-relying block referencing the
      `empirically_reproduced` field
- [x] New test pins the content
- [x] All existing prompt tests (27) still pass
- [x] `pytest tests/ -q` green
- [x] `compute_level --check` green (after propose-first)
- [x] streak 22→23 via Scheduler API

## Files to touch (closed set)

- `scripts/autodev_cycle_prompt.md` (+~12 lines)
- `tests/test_autodev_cycle_prompt.py` (+1 test)
- `CHANGELOG.md` (one line)
- `BACKLOG.md` (note Cycle 42 done)
- `STATE.md` (rewrite)
- `cycles/20260513-163040/PLAN.md` (this)
- `cycles/20260513-163040/REPORT.md`
- `cycles/20260513-163040/RESULT.md`
- `cycles/20260513-163040/next-track-proposal.json`
- `reports/zero-deadlock-streak.txt` (via Scheduler API)
- `reports/cycle-history.jsonl` (via Scheduler API)

## Files forbidden to touch

- `.env*`, `secrets/**`, `LEVEL.md`, anything in §0.
- `FAILURES.md` (Cycle 41's work; this cycle is the prompt
  side of the same discipline thread).

## Rollback plan

`git reset --hard autoevo/pre-20260513-163040`.

## Risk score

low. Pure docs addition to the prompt + one new structural
test.

## FAILURES.md pre-flight result

Keywords: prompt, ORIENT, verify, FAILURES, empirically,
preflight.

- **FAIL-0002** matched on `preflight`. **Cited and
  disambiguated**: FAIL-0002 is about the impossible-spec
  infinite-loop in `_do_planning`, fixed by V4's
  `orchestrator/preflight.py` module which detects symbol-
  absent-from-forbidden-file patterns. This cycle's use of
  "preflight" refers to the FAILURES.md preflight grep in the
  cycle prompt's PLAN step (i.e.
  `scripts/preflight_failures.py`), a completely different
  preflight surface. No code change to
  `orchestrator/preflight.py` or `_do_planning`. Different
  layer; not a repeat.
- No other FAILURES.md matches.

## Open questions / blockers

None.
