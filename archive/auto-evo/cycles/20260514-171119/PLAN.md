# Cycle 20260514-171119 PLAN — Cycle δ (self-repair on repeat failure)

## Target dimension
**S — Safety gates** (a new failure-detection + escalation gate: when
a launchd-spawned wake fails with the same signature 3 times
consecutively, the wake script triggers a self-repair handler that
either applies a documented fix OR writes `BLOCKED.md` for the
operator). Secondary: M — ADR-0012 documents the trigger design.

## Specific gap being closed
Without this gate, a launchd-driven cycle that hits a repeatable
failure (e.g., the "Not logged in" pre-β symptom, a `command not
found`, a TCC restriction) will silently retry every 15 minutes
forever, burning operator goodwill and producing identical empty
log files. There's no escalation signal. Per §3 Track S and
§14 escalation triggers, a 3-strike rule is the canonical
escalation cadence. This cycle adds it.

## Change being made
Three-piece, smallest vertical slice:

1. `scripts/autodev_continuous_cycle.sh` — after each `claude -p`
   exit, if exit code was nonzero, compute SHA-256 of `tail -10
   "$cycle_log"`. Persist to `reports/runs/.failure-signature.last`;
   maintain a `reports/runs/.failure-signature.count` integer for
   how many consecutive wakes hit that exact signature. On success
   (exit 0), clear both files. When count >= 3, invoke the
   self-repair handler (default: `bash $REPO/scripts/autodev_self_repair.sh
   <cycle_log_path> <signature>`; overridable via
   `AUTODEV_SELF_REPAIR_BIN` for tests).

2. `scripts/autodev_self_repair.sh` (new) — minimal,
   honest-scope handler: appends one entry to
   `reports/self-repair.log` (timestamp + signature + cycle log
   path) AND writes `BLOCKED.md` with the failure signature, last
   10 lines of the cycle log, and three plausible operator actions
   (consult cycle log; check launchd plist; run doctor). This is
   the "pattern 5 / unknown" fallback from the cycle δ spec.
   Smart pattern-matching for cases 1-4 (Not logged in, command
   not found, Operation not permitted, rate-limit) is **deferred**
   to a future cycle — that requires the self-repair handler to
   invoke `claude -p` recursively, which is a separable concern.

3. `docs/adr/0012-self-repair-on-repeat-failure.md` — documents
   the 3-strike rule, the signature definition (last 10 lines of
   the cycle log), the escape hatch (`AUTODEV_SKIP_SELF_REPAIR=1`),
   why we start with the BLOCKED.md fallback (honest-scope,
   leaves smart-fix to a future cycle), and the alternatives
   rejected (immediate trigger on first fail; LLM-classifying
   each fail; counter-in-database).

## Acceptance criteria
- [ ] At least 4 regression tests added that fail before this
      change and pass after:
      - `test_failure_signature_persists_across_wakes`
      - `test_three_consecutive_same_signature_triggers_repair`
      - `test_one_off_failure_does_not_trigger_repair`
      - `test_signature_resets_after_successful_cycle`
- [ ] One test for the self-repair script itself: it produces
      `reports/self-repair.log` entry AND `BLOCKED.md` when invoked.
- [ ] `pytest -q` green overall.
- [ ] `scripts/compute_level.py --check` exit 0.
- [ ] `scripts/autodev_doctor.sh` exit 0.

## Files to touch (closed set)
- `scripts/autodev_continuous_cycle.sh` (extend)
- `scripts/autodev_self_repair.sh` (new)
- `tests/test_autodev_continuous_cycle.py` (extend with 4 tests)
- `tests/test_autodev_self_repair.py` (new, ≥3 tests)
- `docs/adr/0012-self-repair-on-repeat-failure.md` (new)
- `cycles/20260514-171119/{PLAN,RESULT,REPORT,STATE.before,next-track-proposal}.md`
- `CHANGELOG.md`, `STATE.md`, `reports/zero-deadlock-streak.txt`,
  `reports/cycle-history.jsonl` (RECORD step)

## Files forbidden to touch
- `.env*`, `secrets/**`, `LEVEL.md`, `FAILURES.md`, ADRs 0000-0011,
  the live plist, `scripts/install_launchd_continuous.sh` (γ's
  scope, complete)

## Rollback plan
`git reset --hard autoevo/pre-20260514-171119`

## Risk score
**low.** New code paths in the cycle script are guarded by exit
code != 0 (success path unchanged); the new self-repair script is
only invoked after 3 consecutive identical failures, and its only
side effect is writing `reports/self-repair.log` + `BLOCKED.md` —
both of which are then visible to the operator. No silent action.

## FAILURES.md pre-flight result
`grep -nE 'self.repair|failure.signature|3.consecutive|BLOCKED' FAILURES.md`
→ 0 hits on self-repair patterns. Novel territory (BLOCKED writing
is mentioned in CLAUDE.md but no FAILURES entry exists for the
3-strike auto-trigger pattern).

## Open questions / blockers
None block the cycle. One design note: the self-repair script
currently writes `BLOCKED.md` for every trigger — there's no
"pattern matching" yet. That's an explicit choice for scope; the
LLM-driven pattern-matching path is reserved for a future cycle
because it requires recursive `claude -p` invocation and a much
larger test surface. Operators get a clear "your launchd cycle has
been failing identically for 3 wakes; here's the log; here's what
to check" signal, which is the minimum viable improvement.
