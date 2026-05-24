# Cycle 20260514-171119 Report — Cycle δ (self-repair on repeat failure)

## Verdict
**PASS** — adds the 3-strike same-signature failure trigger to
`scripts/autodev_continuous_cycle.sh` and a new minimal handler
`scripts/autodev_self_repair.sh` that escalates to BLOCKED.md.
+11 regression tests (4 trigger + 7 handler). ADR-0012 documents
the design and the deferred LLM-pattern-matching scope.

## Target dim
**S — Safety gates**, new escalation gate. Side effect: M — ADR-0012
adds the 10th ADR.

## Level changes
None. M/S/R/T/E stay at L7. C 4 → still L4 (streak 28→29, **1
cycle shy of L5**). Overall L = 4 unchanged.

## Change

`scripts/autodev_continuous_cycle.sh` post-`claude -p`:
- Compute `sha256(tail -n +2 cycle_log | tail -10)` on nonzero
  non-timeout exit (skipping the wake-script's timestamp preamble
  on line 1 so the signature is stable across wakes).
- Persist signature + count to `reports/runs/.failure-signature.{last,count}`.
- Same signature → increment count; different → reset to 1.
- `count >= AUTODEV_SELF_REPAIR_THRESHOLD` (default 3) →
  invoke `${AUTODEV_SELF_REPAIR_BIN:-bash $REPO/scripts/autodev_self_repair.sh}`.
- Successful cycle (exit 0) → remove both state files.
- `AUTODEV_SKIP_SELF_REPAIR=1` disables the trigger entirely.

`scripts/autodev_self_repair.sh` (new, minimal scope):
- Appends one line to `reports/self-repair.log`.
- Writes `BLOCKED.md` with the signature, last 20 lines of the
  cycle log, and three plausible operator actions (consult log,
  check live plist matches `--dry-run`, run `autodev_doctor`).
- Exits 0 on success; nonzero only on missing cycle log path.

`docs/adr/0012-self-repair-on-repeat-failure.md` documents the
3-strike rule, the BLOCKED.md-only scope (smart pattern-matching
deferred because recursive `claude -p` would re-introduce Cycle β's
keychain-ACL concern), and 5 alternatives rejected.

## Files modified
```
 M scripts/autodev_continuous_cycle.sh        (+45 / -0; plus the
                                               1-line preamble-skip fix)
 A scripts/autodev_self_repair.sh              (+106; executable)
 M tests/test_autodev_continuous_cycle.py     (+131)
 A tests/test_autodev_self_repair.py           (+115)
 A docs/adr/0012-self-repair-on-repeat-failure.md (+187)
 A cycles/20260514-171119/{PLAN,RESULT,REPORT}.md
 M CHANGELOG.md
 M STATE.md
 M reports/{zero-deadlock-streak.txt, cycle-history.jsonl}
```

## Tests added (11 total)

Trigger tests (`tests/test_autodev_continuous_cycle.py`):
- `test_failure_signature_persists_across_wakes`
- `test_three_consecutive_same_signature_triggers_repair`
- `test_one_off_failure_does_not_trigger_repair`
- `test_signature_resets_after_successful_cycle`

Handler tests (`tests/test_autodev_self_repair.py`):
- `test_script_exists` + `test_script_executable`
- `test_writes_self_repair_log_entry`
- `test_writes_blocked_md_with_signature`
- `test_missing_cycle_log_path_exits_nonzero`
- `test_repeated_invocations_append_not_overwrite_log`
- `test_blocked_md_includes_path_to_cycle_log`

TDD intent satisfied: test commit precedes feat + handler commits
on this branch.

## Verify output (truncated)

```
$ python3 -m pytest tests/ -q --ignore=workspaces --ignore=worktrees \
    --deselect <3 pre-existing>
667 passed, 2 skipped, 3 deselected

$ python3 scripts/compute_level.py --check
[compute_level] check passed (overall L=4)
(exit 0)

$ bash scripts/autodev_doctor.sh; echo $?
=== summary: 14 passed, 1 failed, 1 warned ===
0
```

## §0 compliance audit (Cycle δ, abbreviated)

All 12 rules clean:
- Rule 3: `autodev_self_repair.sh` reads only the cycle log + writes
  BLOCKED.md + self-repair.log. Never touches `.env` / secrets/ /
  *.key / *.pem.
- Rule 6: this cycle ADDS an escalation gate, doesn't weaken any.
- Rule 11: ~25 min wall clock, within 45-min budget.

## Bug caught + fixed mid-cycle

`test_three_consecutive_same_signature_triggers_repair` failed
initially: signature was computed over `tail -10 cycle_log`, which
included the wake-script's `[ts] Cycle dispatch starting`
preamble line. For short failure outputs (auth fail, command-
not-found — exactly the cases that trip 3 strikes in production),
the preamble's timestamp differed every wake → signature
differed → count never advanced. Fix: `tail -n +2 | tail -10`
skips the preamble. **This is a production correctness bug, not
just a test artifact** — without the fix, the trigger would
never fire in real launchd operation for the most common
failure modes.

## Next recommended track
Per proposal: Track C3-live (P1, dim=C, score=6.00). But the
session continues directly to **Cycle ε**: hourly cadence option
+ AUTODEV_DONE.md celebration on stable Overall L = AUTODEV_TARGET_L.

## Wall clock used
~25 minutes.
