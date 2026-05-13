# Cycle 20260513-141046 Report — Cycle 33 (FAIL-0009 fix)

## Verdict

PASS — fix shipped; **failure ledger corrected**.

The previous session's handoff doc named this as the highest-value
pickup and the named risk for the launchd-driven path. The fix
itself is a 3-line env-var gate. The harder work was verifying
the root cause empirically — and the verification proved the
original FAILURES.md entry was wrong about where the writes
came from. M-dim discipline: when evidence contradicts the
ledger, fix the ledger.

## Level changes

None. S already at L7 max. C streak 13→14.

## Empirical root-cause diagnosis (RED before fix)

The original FAIL-0009 entry blamed `scripts/autodev_doctor.sh`
for dirtying `reports/session-log.md`. Two snapshot/diff tests
contradicted that:

```bash
# Test A: doctor alone
$ cp reports/session-log.md /tmp/before.md
$ bash scripts/autodev_doctor.sh > /dev/null
$ diff /tmp/before.md reports/session-log.md
# (no output — doctor is clean)

# Test B: pytest alone
$ cp reports/session-log.md /tmp/before2.md
$ python3 -m pytest tests/test_autodev_claude_code_cli.py -q > /dev/null
$ diff /tmp/before2.md reports/session-log.md | head
# 4 new lines appended (cli.execution rate_limited / permission /
# success / cli.timeout) — pytest IS the culprit
```

Reason: the 4 unit tests in `tests/test_autodev_claude_code_cli.py`
mock `subprocess.run` to return canned JSON envelopes, then call
`ClaudeCodeCLIExecutor.run_prompt("hi")`. The executor's
`_parse_result()` and timeout path call `self._log()`, which
opens the REAL `reports/session-log.md` and appends. The tests
never monkeypatch `session_log_path()` or `_log()`, so they leak.

## Change (GREEN after fix)

1. **`autodev/executors/claude_code_cli.py:_log()`** — 3 new
   lines at the start:
   ```python
   if os.environ.get("AUTODEV_AUDIT_LOG_SUPPRESS"):
       return
   ```
   Opt-in suppression. Production cli executor calls never set
   this var; tests/conftest does.

2. **`tests/conftest.py`** — one new top-level statement:
   ```python
   os.environ.setdefault("AUTODEV_AUDIT_LOG_SUPPRESS", "1")
   ```
   pytest loads conftest before any test collection. All
   subsequent imports + tests inherit the suppression.

3. **`tests/test_doctor_no_side_effect.py`** (new, 4 tests):
   - `test_doctor_leaves_session_log_clean` — snapshot before,
     run doctor, snapshot after, assert equal. Pins the doctor's
     innocence forever.
   - `test_cli_executor_tests_clean_with_suppress` — snapshot,
     run cli-executor unit tests with the env var set, snapshot,
     assert equal. Pins the fix.
   - `test_suppress_env_var_is_documented_in_executor` — string
     `AUTODEV_AUDIT_LOG_SUPPRESS` appears in
     `autodev/executors/claude_code_cli.py` so future maintainers
     can find the knob.
   - `test_pytest_conftest_sets_suppress_by_default` — the var
     name appears in `tests/conftest.py` so the suppression is
     the documented default for this repo's test runs.

4. **`FAILURES.md` FAIL-0009 entry** — appended a
   `### Corrected diagnosis (2026-05-13, Cycle 33)` sub-block
   that:
   - Shows the empirical cp/diff experiment with both branches
     (doctor → no change; pytest → 4 lines appended).
   - Identifies the actual root cause (tests calling `_log()`
     against the real path).
   - Documents the actual working fix (env-var gate +
     conftest default).
   - Explains the misattribution mechanism ("doctor was the
     most plausible suspect, never verified") and proposes a
     ledger-discipline rule: **every FAILURES.md entry whose
     root cause was inferred rather than empirically reproduced
     should be tagged so future cycles know to verify before
     relying on it**.

   The ORIGINAL Symptom / Root cause / Working fix text is
   preserved above the Corrected block — the ledger is
   append-only by convention, so the misattribution stays as
   a learning artifact rather than being silently overwritten.

## Files modified

```
autodev/executors/claude_code_cli.py            (+5 lines, _log() guard)
tests/conftest.py                               (+8 lines, env-var set)
tests/test_doctor_no_side_effect.py             (new, 4 tests)
FAILURES.md                                     (FAIL-0009 corrected block)
CHANGELOG.md, BACKLOG.md, STATE.md
reports/zero-deadlock-streak.txt                (13→14)
reports/cycle-history.jsonl                     (+ entry)
reports/session-log.md                          (committed as-is —
                                                 the prior session's
                                                 pre-fix accumulation;
                                                 going forward, pytest
                                                 will not add to it)
cycles/20260513-141046/*
```

## Verify

- `pytest tests/ -q`: 548 passed, 2 skipped, 0 failed (+4 from this cycle)
- Empirical: `cp / pytest / diff` shows pytest no longer dirties
  the file (the suppression takes effect)
- Empirical: `cp / doctor / diff` shows the doctor was always
  innocent (the corrected diagnosis is confirmed)
- `propose_next_track --for-cycle 20260513-141046` → proposal artifact
  written FIRST per Cycle 25 ordering rule
- `compute_level --check` (post-proposal): passed (Overall L=4 stable)
- `autodev_doctor.sh`: 13/0/2

## Constraints honored

- No `git push`. No PR merge. No secret touch.
- The fix is opt-in: production cli executor calls (real
  `claude -p` from the orchestrator) do NOT set this env var, so
  audit logging continues normally there. Only repo-local pytest
  runs are suppressed.
- The FAILURES.md correction is APPENDED, not a rewrite. The
  original misattribution is preserved as a learning artifact.
- The dirty `reports/session-log.md` is committed as-is (file
  is append-only by convention; the prior accumulation is real
  history of the pre-fix sessions). Going forward, no further
  pytest-driven writes will occur.
- 45-min budget: ~12 minutes for this cycle.

## Why this unblocks the launchd-driven path

The wake script (`scripts/autodev_continuous_cycle.sh`) calls
`pytest` during VERIFY of every cycle. Before this fix, every
wake would have dirtied `reports/session-log.md`, then the next
wake's §4 step 1 ("git status must be clean") would have written
BLOCKED.md and skipped dispatch. The launchd path would have
stalled within 1-2 cycles.

With the fix: pytest under the wake script inherits the conftest's
env-var assignment → no write to session-log.md → working tree
stays clean → wake N+1 proceeds normally. The launchd path is
unblocked.

## Procedural lesson reinforced

Cycle 25 surfaced: "always run `propose_next_track --for-cycle <id>`
BEFORE `compute_level.py --check`" — encoded in the standing
prompt.

Cycle 33 surfaces: **"verify FAILURES.md root causes empirically
before relying on them"** — a new M-dim discipline. The original
FAIL-0009 entry was wrong because nobody ran the cp/diff
experiment until 30 cycles later. The proposed encoding: a
future cycle could add a FAILURES.md template field
`empirically_reproduced: yes/no` so misattribution is
distinguishable from confirmed root cause.

This lesson is documented in the corrected FAIL-0009 block; a
future M-dim cycle could lift it into a script-enforced template.

## Next

Phase D continuation. The C streak is now 14/30 → 16 more
disciplined cycles for C-L5 → Overall L=5.

Reasonable next targets:
- Track S5 (adversarial subagent return-check) — small
- Track S6 (canary-token leakage scan) — small regex
- Track P1 (strict Planner output contract) — medium

Watch for context budget approaching 80% — write session-handoff
and exit cleanly at that point.

## Wall clock

~12 minutes.
