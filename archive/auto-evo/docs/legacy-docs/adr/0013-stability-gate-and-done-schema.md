# ADR-0013: Stability gate + expanded AUTODEV_DONE.md schema + HUMAN_CONFIG cadence

## Context

Cycle ε is the last of the AUTH_AND_SELFREPAIR plan. After it
lands, the L7 24/7 supervisor should be able to decide for itself
when its work is done — and recover from "Done? Just kidding"
flapping at the level boundary.

Three gaps exist after Cycle δ:

1. **The wake script writes `AUTODEV_DONE.md` on the FIRST
   cycle where `Overall L >= AUTODEV_TARGET_L`.** A single
   flaky cycle (e.g., a level-up due to a test that later turns
   out to be flaky, or a CHANGELOG line that pushes a dimension
   over the line for a moment) can quiesce the supervisor
   prematurely. Operators have to manually `rm AUTODEV_DONE.md`
   and lose the celebration moment.

2. **`AUTODEV_DONE.md`'s content is minimal**: "Overall L = X
   reached target Y." Operators get no summary of what was
   achieved across the months/years of cycle runs.

3. **The launchd cadence (15-min vs 1-hour) is only env-tunable.**
   `AUTODEV_INTERVAL_SECONDS` is the env knob, but there's no
   canonical operator-readable setting in `HUMAN_CONFIG.md`.
   Operators wanting 1-hour steady-state had to learn the env
   name from the install script source.

## Decision

Three coordinated changes:

### 1. Stability gate (`scripts/autodev_continuous_cycle.sh`)

Replace the termination block:

- Persist a counter to `reports/level5-stability.txt`. Incremented
  on every wake where `Overall L >= TARGET_L`. Removed (and reset
  to 0 next time) on any wake where `Overall L < TARGET_L`.
- Write `AUTODEV_DONE.md` only when the counter reaches
  `AUTODEV_STABILITY_THRESHOLD` (default 5) consecutive at-target
  wakes.
- `AUTODEV_SKIP_STABILITY_GATE=1` env trips DONE.md on the first
  qualifying wake (emergency-stop or test override).

Why 5 consecutive: matches §13's "5 consecutive PASS cycles with
no level-up" escalation cadence, and matches the C-dim 30-cycle
zero-deadlock streak threshold's *spirit* — a few cycles confirm
that a transient achievement wasn't a fluke. 5 is enough for
flakes to wash out without being so high it traps the operator
in a perpetual "almost-there" state.

### 2. Expanded `AUTODEV_DONE.md` schema

The new DONE.md contains:

- Reached-at timestamp (UTC ISO-8601).
- Overall L + target + stability counter at trip time.
- Per-dimension levels block (from `LEVEL.md`, fenced).
- Cumulative totals table:
  - Cycles executed (count of `CHANGELOG.md` `YYYYMMDD-HHMMSS |`
    rows — robust to formatting drift because the grep is exact).
  - Total git commits on current branch.
  - C-dim streak high-water mark (from
    `reports/zero-deadlock-streak.txt`).
  - Bootstrap commit timestamp (from `git log --reverse`).
  - Codex token spend total (sum of `tokens_used` across
    `reports/codex-spend.jsonl`).
- Honest assessment section listing what the system CAN now do
  (drive cycles; survive launchd; reinstall its plist; escalate
  repeat failures; decide when done) and what it still CANNOT
  (product/UX decisions; novel architecture; crisis response).
  The §1 "honest ceiling" is restated, not paved over.
- Resume instructions (raise target, rm DONE.md).

Missing data renders as `NO_DATA` rather than aborting. The
wake script's `set -u` is preserved by guarding every external
read with `2>/dev/null || echo NO_DATA`.

### 3. HUMAN_CONFIG cadence canonical

`HUMAN_CONFIG.md` `runtime:` block gains
`launchd_interval_seconds: 900` with a comment recommending 3600
for steady-state. The install script's `INTERVAL` resolution
order becomes:

1. `AUTODEV_INTERVAL_SECONDS` env (operator/test override).
2. `HUMAN_CONFIG.md` `launchd_interval_seconds:` value
   (canonical).
3. 900-second default.

Existing operators who set `AUTODEV_INTERVAL_SECONDS` via the
plist or shell get the same behavior; new operators discover
the canonical setting in HUMAN_CONFIG.

## Consequences

### Good
- Flaky single-cycle level-ups no longer quiesce the supervisor.
- Operators get a comprehensive achievement summary when the
  supervisor decides it's done — months of cycle work
  summarized in one file.
- Cadence is documented in the operator-visible config file,
  not buried in an env variable.
- Drop in level CLEARS the stability counter; partial progress
  isn't accidentally banked.

### Bad
- Minimum 5 wakes (~75 min at 15-min cadence; ~5 h at 1-h
  cadence) to celebrate after first hitting target. For long
  cycles already on a stable level, that's a one-time delay.
- The DONE.md schema is opinionated — future changes to
  CHANGELOG format would invalidate the "Cycles executed" count.
  Test `test_done_md_schema_has_expanded_fields` pins the
  required field names so format changes break a test loudly.
- `AUTODEV_SKIP_STABILITY_GATE` exists as an emergency-stop
  knob. Misused, it re-introduces the pre-ε one-cycle trip.
  The env name explicitly mentions "SKIP" to discourage casual
  use.

## Alternatives Rejected

1. **No stability gate — trip immediately as before.** Rejected:
   leaves the flaky-level-up risk open. The whole reason for ε
   is that risk.
2. **3-cycle stability instead of 5.** Considered. Rejected:
   matches the δ self-repair threshold (3 = trip) but works in
   the opposite direction (trip = STOP good thing). The
   operator-celebration moment deserves stricter confirmation;
   5 is the next round number and aligns with §13's "5
   consecutive PASS cycles with no level-up" escalation.
3. **Bank the stability counter across config changes.**
   Considered: if the operator raises `AUTODEV_TARGET_L` from
   5 to 6 mid-stride, should the counter survive? Rejected:
   different target = different goal; the counter resets when
   `overall < TARGET_L` regardless of why (level drop OR target
   raise produce the same condition).
4. **Embed the DONE.md schema in a separate file
   (`docs/done-schema.md`).** Rejected: keeps the
   schema co-located with the wake script that emits it; one
   place to read, one place to update.
5. **Parse HUMAN_CONFIG.md with a real YAML parser.** Rejected:
   the install script is bash; pulling in `python3 -c` for one
   value would force Python on operators who don't have it in
   PATH. `grep -oE` on one specific line is enough.

## Linked regression tests

`tests/test_autodev_continuous_cycle.py`:
- `test_target_l_reached_writes_done_md` (rewritten for
  emergency-stop env path)
- `test_stability_counter_increments_at_target`
- `test_stability_counter_resets_on_level_drop`
- `test_five_consecutive_at_target_writes_done`
- `test_done_md_schema_has_expanded_fields`

`tests/test_install_launchd_continuous.py`:
- `test_human_config_interval_used_when_env_unset`
- `test_env_interval_wins_over_human_config`

## Linked ADRs

- [ADR-0010](0010-launchd-auth-via-env-var.md) — Cycle β; the
  auth fix that makes 24/7 operation viable in the first place.
- [ADR-0011](0011-launchd-install-idempotence.md) — Cycle γ;
  install-script discipline that this cycle extends with the
  HUMAN_CONFIG fallback.
- [ADR-0012](0012-self-repair-on-repeat-failure.md) — Cycle δ;
  the failure-escalation gate. Cycle ε is its symmetric
  partner — success-celebration gate.

## Linked cycle

Cycle ε (CYCLE_ID `20260514-201707`), branch
`autoevo/cycle-epsilon/hourly-cadence-and-done-celebration`.

This closes the AUTODEV_L7_AUTH_AND_SELFREPAIR.md 5-cycle plan
(α subsumed by BLOCKED.md resolution; β/γ/δ/ε all PASS).
