# ADR-0012: Self-repair trigger on 3 consecutive same-signature wake failures

## Context

After Cycle β fixed the launchd-keychain auth gap, the 24/7
supervisor can authenticate under launchd — but `claude -p` can
still fail for many other reasons: a transient rate-limit, a TCC
restriction on file access, a missing `gh` CLI, an upstream model
outage, a dirty working tree introduced by a prior cycle. Without
escalation, the launchd agent silently fires every 15 minutes
forever, accumulating identical empty cycle logs and burning
operator goodwill.

§14 of `AUTODEV_L7_MASTER_PROMPT.md` (Escalation Triggers) names
"Same FAILURES entry hit 3 cycles in a row" as a learning-failure
condition. The natural generalization: any **same-signature**
failure repeating N times is the same signal, even before a
FAILURES entry has been written for it.

## Decision

**The wake script computes a SHA-256 signature over the last 10
lines of claude's output in each cycle log and trips a self-repair
handler when 3 consecutive nonzero-exit wakes share the same
signature.**

Implementation:

1. `scripts/autodev_continuous_cycle.sh` (post-`claude -p` block):
   - On `cycle_exit != 0 && != 124` (124 = timeout, already
     handled): `sig = sha256(tail -n +2 cycle_log | tail -10)`.
     Skipping line 1 (the `[<timestamp>] Cycle dispatch starting`
     header) ensures the signature is stable across wakes for
     identical failure output; without this, short failure logs
     would include the wake-specific timestamp and always look
     distinct.
   - Compare to `reports/runs/.failure-signature.last`. If
     identical: increment `reports/runs/.failure-signature.count`.
     If different: reset both files (new failure → count=1).
   - If `count >= 3` (overridable via
     `AUTODEV_SELF_REPAIR_THRESHOLD`): invoke
     `scripts/autodev_self_repair.sh <cycle_log> <signature>`
     and clear the counter so the handler gets one shot per
     3-strike window. Operator action expected before next attempt.
   - On `cycle_exit == 0`: remove both state files. Successful
     cycles clear all prior failure momentum.

2. `scripts/autodev_self_repair.sh` (new, minimal scope):
   - Appends one entry to `reports/self-repair.log` with the
     timestamp, signature prefix, and cycle log path.
   - Writes `BLOCKED.md` with the signature, last 20 lines of
     the cycle log, and three plausible operator actions
     (consult log; check launchd plist matches `--dry-run`;
     run `autodev_doctor.sh`).
   - Exits 0 on success; exits nonzero only if the cycle log
     path doesn't exist (defensive — we don't fabricate failure
     context).

3. Escape hatch: `AUTODEV_SKIP_SELF_REPAIR=1` disables the
   trigger entirely (debugging or pre-flight test runs).

## Why the BLOCKED.md fallback is the only fix path right now

The cycle δ spec hinted at pattern-matching known failure modes
(e.g., "Not logged in" → re-source `.env`; "rate limit" → write
`quota-rate-limit-until.ts`; "command not found" → re-check PATH
in plist). All of those require either:

- Re-invoking `claude -p` recursively to classify the failure
  (re-introduces the keychain-ACL concern Cycle β just closed and
  doubles the wake-script's runtime surface), OR
- Hard-coded regex patterns that drift out of date as Claude's
  error messages evolve.

For now, the self-repair handler **only** writes BLOCKED.md.
This is honest scope: every 3-strike trip surfaces a clear,
human-readable escalation with three concrete next steps. The
LLM-driven pattern matcher is a separate cycle whose risk surface
deserves its own ADR.

## Consequences

### Good
- Repeat-failure spirals end in a visible BLOCKED.md within 3
  wakes (~45 min at 15-min cadence; ~3 h at 1-h cadence
  introduced by Cycle ε).
- Operator gets exactly one BLOCKED.md per 3-strike window
  (counter cleared post-trigger), so the handler doesn't
  spam-write while the operator is debugging.
- The `.failure-signature.*` state files live under
  `reports/runs/` which is gitignored (per ADR-0009's runtime-
  emission-not-tree-dirty discipline), so they never trip the
  §4 step 1 "git status clean" gate.
- Successful cycles automatically reset the counter, so
  intermittent failures (1-fail-2-success-1-fail-2-success...)
  never accumulate spurious trip-counts.

### Bad
- The 3-strike rule means up to 3 identical wake failures will
  burn through before escalation. At 15-min cadence that's
  ~45 minutes of identical wasted runs.
- A signature collision is theoretically possible (two genuinely
  different failures whose last-10-lines hash identically). SHA-256
  on 10 lines is conservative enough that the practical collision
  rate is negligible.
- The minimal BLOCKED.md content depends on `tail -20` of the
  cycle log; if a wake produces less than 20 lines (very short
  failure), BLOCKED.md gets a small snippet. Operators may need
  to consult the full log.
- Pattern-specific auto-fixes (the deferred work) won't land in
  this cycle; the operator continues to be the only fixer.

## Alternatives Rejected

1. **Trigger on first nonzero exit.** Rejected: too noisy.
   Most failures are transient (network, rate-limit, momentary
   `claude` startup hiccup). 3-strike rule filters those out.
2. **Trigger on any 3 consecutive nonzero exits, regardless
   of signature.** Rejected: would conflate genuinely different
   failure modes. The signature gate ensures the 3-strike trip
   only fires for a STUCK failure, not a series of distinct ones.
3. **Use a SQLite table for failure-signature history.**
   Rejected: heavier than needed; the `.failure-signature.{last,
   count}` two-file scheme is enough and matches the existing
   `last_wake.ts` + `quota-rate-limit-until.ts` patterns under
   `reports/runs/`.
4. **Make the self-repair handler invoke `claude -p`
   recursively** to pattern-match and apply known fixes. Rejected
   for this cycle; the keychain-ACL concern Cycle β just closed
   would re-emerge (the self-repair `claude` invocation needs the
   same env-var routing) and the test surface would balloon.
   Reserved for a future cycle.
5. **Write FAILURES.md entries automatically instead of
   BLOCKED.md.** Rejected: FAILURES.md is the post-resolution
   ledger ("here's the failure, here's the fix, here's the
   regression test"). At trigger time we have only symptom
   data, no diagnosis and no fix — that's BLOCKED.md territory.

## Linked regression tests

`tests/test_autodev_continuous_cycle.py`:
- `test_failure_signature_persists_across_wakes`
- `test_three_consecutive_same_signature_triggers_repair`
- `test_one_off_failure_does_not_trigger_repair`
- `test_signature_resets_after_successful_cycle`

`tests/test_autodev_self_repair.py`:
- `test_script_exists` / `test_script_executable`
- `test_writes_self_repair_log_entry`
- `test_writes_blocked_md_with_signature`
- `test_missing_cycle_log_path_exits_nonzero`
- `test_repeated_invocations_append_not_overwrite_log`
- `test_blocked_md_includes_path_to_cycle_log`

## Linked ADRs

- [ADR-0009](0009-runtime-emission-no-tree-dirty.md) — runtime
  emission discipline; `.failure-signature.*` lives under
  `reports/runs/` (gitignored) per this rule.
- [ADR-0010](0010-launchd-auth-via-env-var.md) — Cycle β; the
  reason the deferred LLM-driven pattern-matcher is risky.
- [ADR-0011](0011-launchd-install-idempotence.md) — Cycle γ;
  the install script's `--dry-run` is one of the three operator
  actions BLOCKED.md recommends.

## Linked cycle

Cycle δ (CYCLE_ID `20260514-171119`), branch
`autoevo/cycle-delta/self-repair-on-repeat-failure`.
