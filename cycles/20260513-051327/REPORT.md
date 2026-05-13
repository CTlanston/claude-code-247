# Cycle 20260513-051327 Report — Phase B Cycle 26 (cycle prompt)

## Verdict
PASS — infrastructure cycle. `scripts/autodev_cycle_prompt.md` is the
standing instruction `claude -p` will read on every launchd wake.
27 structural tests pin the required sections. No dim move (and none
expected — this is infrastructure that enables the C-streak to
accumulate via launchd, it doesn't move a rubric dim itself).

## Level changes

None. C streak bumped 6→7 (no deadlock observed).

## Change

1. **`scripts/autodev_cycle_prompt.md`** (new, ~7 KB):
   The standing prompt for the launchd-driven `claude -p`. Six
   sections per the kickoff doc spec:
   - **ORIENT** — silent reads of STATE/CHANGELOG/FAILURES/LEVEL/
     BACKLOG/BLOCKED/CONTEXT + the prior cycle's REPORT.
   - **DECISIONS** — deterministic stop checks: BLOCKED<24h skip,
     AUTODEV_DONE skip, STOPSWITCH skip, Overall L >= AUTODEV_TARGET_L
     writes AUTODEV_DONE and exits, otherwise prefer
     `propose_next_track` output then BACKLOG top.
   - **ACT** — §4 steps 1-10: rollback tag, PLAN with all required
     fields, preflight, TDD implementation, VERIFY, RECORD,
     atomic commit on `autoevo/cycle-<N>/<slug>`.
   - **CONSTRAINTS** — §0 (12 rules), §13, §16, ADR-0008 codex budget
     guard, 45-min budget, one-dim-per-cycle.
   - **C-DIM SPECIAL HANDLING** — call
     `Scheduler.record_cycle_success(cycle_id, deadlock=)` when the
     cycle dispatched into a worktree; otherwise just bump the
     streak counter file. The 30-cycle target for C-L5 is stated.
   - **OUTPUT** — exit 0 unconditionally; stdout/stderr go to
     `reports/runs/<ts>.log`.

   **Cycle 25 procedural lesson encoded as VERIFY-step ordering**:
   the prompt explicitly says
   "run `propose_next_track --for-cycle ${CYCLE_ID}` BEFORE
   `compute_level --check`". Without this rule, the last-5-cycles
   E-dim window transiently shows 4/5 (current cycle's proposal not
   yet written) → E false-regresses 7→4 → `--check` trips. The
   structural test pins the rule so a future edit can't drop it.

2. **`tests/test_autodev_cycle_prompt.py`** (new, 27 tests):
   - Existence + non-trivial size (2)
   - 6 canonical section headings present (6)
   - L7 master-prompt cites: §0, §13, §16, 45-min budget,
     ADR-0008 codex budget guard (5)
   - Headless markers: no "ask the human" in non-negated context,
     explicitly forbids clarifying questions, one-cycle-per-wake (3)
   - Procedural-lesson ordering rule encoded (1)
   - §4 protocol references: pytest, rollback tag, FAILURES.md
     preflight, atomic commit, 30-cycle streak, AUTODEV_TARGET_L,
     AUTODEV_DONE, STOPSWITCH, BLOCKED (9)
   - Forbidden things: no `git push` instruction in non-negated
     context (1)

   Each test is a focused regex/substring check. The prompt is read
   by an LLM, not executed; structural drift is the failure mode we
   guard against, so checking text content is the right oracle.

## Files modified
```
scripts/autodev_cycle_prompt.md                 (new)
tests/test_autodev_cycle_prompt.py              (new, 27 tests)
CHANGELOG.md, BACKLOG.md, STATE.md
reports/zero-deadlock-streak.txt                (6→7)
reports/cycle-history.jsonl                     (+ entry)
cycles/20260513-051327/*
```

## Verify

- `pytest tests/ -q`: 412 passed, 2 skipped, 0 failed (+27 from this cycle)
- `propose_next_track --for-cycle 20260513-051327` → proposal artifact
  written FIRST per the encoded ordering rule
- `compute_level --check` (post-proposal): passed (Overall L=4 stable)
- `autodev_doctor.sh`: 12 passed, 0 failed, 2 warned
- Streak: 7/30 → 23 more disciplined cycles needed for C-L5

## Constraints honored

- No `git push`. No PR merge. No secret touch. None applicable.
- The prompt does NOT instruct the cycle to push, merge, or touch
  secrets — the structural test `test_no_git_push_instruction`
  asserts this with a negation-tolerant regex.
- 45-min budget: ~10 minutes for this cycle.
- One dim by one increment: no dim moved; this is infra that
  enables Phase D's C-streak accumulation.

## Procedural-lesson cross-reference

The Cycle 25 RECORD-ordering rule is now encoded in TWO places:
1. **`scripts/autodev_cycle_prompt.md`** — instructional text the
   LLM reads on each wake.
2. **`tests/test_autodev_cycle_prompt.py::test_encodes_propose_before_compute_check_ordering`** —
   structural pin that fails if the rule is removed.

Future cycle authors will see both. If either drifts away from the
other, the test fails and the drift surfaces.

## Next

**Phase B Cycle 27**: `scripts/install_launchd_autodev.sh` — the
plist generator. `--install` / `--uninstall` / `--status` flags;
idempotent; DO NOT auto-install (operator runs the install once
after Phase B is complete).

## Wall clock
~10 minutes.
