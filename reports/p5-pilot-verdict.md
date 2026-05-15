---
name: P5 Pilot Verdict (regrade)
description: P5 pilot regrade at +25h with diagnosis of why the cycle stalled
type: report
---

# P5 Pilot Verdict — Regrade

**Generated**: 2026-05-15T22:40:00Z
**Window**: ~25h since filing (start ts 2026-05-14T21:41:52Z)
**Issues filed**: 10 — 19 20 21 22 23 24 25 26 27 29
**Repo**: CTlanston/auto-evo-playground

## Metrics (raw)

| Metric | Value | Threshold | Pass |
|--------|-------|-----------|------|
| Completion rate (human_review) | 10% (1/10) | ≥ 70% | ✗ |
| Merge rate (human judgment) | not assessed | ≥ 50% | — |
| Blocker / fail rate | 0% (0/10) | ≤ 20% | ✓ |
| Median cycle wall time | ~683 min | ≤ 60 min | ✗ |

**Raw thresholds met**: 1 / 4 → would read as FAIL.

## Per-issue breakdown

| Issue | Status | PR | First-update→last-update (min) | Notes |
|-------|--------|-----|------|-------|
| #19 | ci_running | — | 147 | Reached CI ~2.5h after intake |
| #20 | queued | — | 1105 | review_rounds=1, credit 65 — failed review, requeued, never re-picked |
| #21 | queued | — | 1059 | same pattern as #20 |
| #22 | queued | — | 1030 | same pattern as #20 |
| #23 | queued | — | 859 | same pattern as #20 |
| #24 | human_review | #30 OPEN | 149 | Reached human_review ~2.5h after intake — golden path |
| #25 | queued | — | 508 | review_rounds=0 — picked up but never advanced |
| #26 | queued | — | 289 | review_rounds=0, no branch — never picked up |
| #27 | queued | — | 219 | review_rounds=0, no branch — never picked up |
| #29 | queued | — | 939 | review_rounds=0, no branch — never picked up |

## Diagnosis — why the raw metrics are misleading

The pilot did not stall because the inner engine cannot handle these
issues. It stalled because of a **self-inflicted shutdown gate**:

1. `reports/AUTODEV_DONE.md` was written 2026-05-14T20:55:56Z (cycle-50
   mission-complete).
2. The launchd dispatcher has refused every wake since 2026-05-14T21:13:34Z
   with `AUTODEV_DONE.md present — mission complete, exiting.`
3. `state/PAUSED` exists (touched 2026-05-15T18:47Z) — a second hard stop.
4. Net effect: ~20 minutes after P5 was filed, the orchestrator stopped
   driving cycles. Issues 19 and 24 happened to complete inside that
   ~2.5-hour window (cycle times 147 min and 149 min — within the
   60–180 min budget for L7 issues, *not* 60 min).

Evidence:

```
[2026-05-14T20:58:34Z] cycle exit=0
[2026-05-14T21:13:34Z] AUTODEV_DONE.md present — mission complete, exiting.
... 30+ identical entries through 2026-05-15T22:28:14Z ...
```

## Honest verdict

**INCONCLUSIVE.** The P5 pilot cannot be judged from this run because the
mission-complete gate fired during the pilot window. Two issues (19, 24)
that completed before the gate engaged advanced normally — that is positive
evidence the inner engine still works on real GitHub issues end-to-end.
The other eight are not "system failed to deliver"; they are "system was
turned off".

## Required fix cycles before retrying P5

**Fix-1 (P0): allow pilot mode to override the DONE gate.**
The launchd dispatch script must not exit on `AUTODEV_DONE.md` when there
are open P5 pilot tasks. Suggested mechanic: a sentinel file
`reports/PILOT_IN_PROGRESS` whose presence beats `AUTODEV_DONE.md`. Owner
needs to decide whether DONE.md represents a hard mission boundary or a
soft "I think I am done" signal — currently it is both, which conflicts.

**Fix-2 (P0): inspect why review_rounds=1 issues never get re-picked.**
Issues 20–23 all hit one review round, lost credit (100→65), and were
requeued — but `select_new_task` never picked them up again across a full
working day. This is independent of the DONE gate and would have stalled
the pilot even without it. Need to look at the orchestrator's
`select_new_task` ordering vs. the credit threshold.

**Then**: clear `AUTODEV_DONE.md` + `state/PAUSED`, ensure the
PILOT_IN_PROGRESS sentinel is honored, re-grade after another 24h with
unattended dispatch enabled.

### Fix-1 status: implemented in this branch

The outer-loop fix is done — `scripts/autodev_continuous_cycle.sh` now
honors `reports/PILOT_IN_PROGRESS` and bypasses both the `AUTODEV_DONE.md`
and `STOPSWITCH` gates when it is present. Health<50 and BLOCKED.md still
gate as before. Coverage: 4 new tests in
`tests/test_autodev_continuous_cycle.py` (override DONE; override
STOPSWITCH; does NOT override health<50; does NOT override BLOCKED). Full
suite: 30/30 green.

### Operator runbook to retry P5

1. `touch reports/PILOT_IN_PROGRESS` (operator decision: starts the pilot
   window — overrides DONE/STOPSWITCH).
2. Decide on `state/PAUSED`: remove it if you want unattended dispatch
   resumed, leave it if you want manual control.
3. Wait ~24 h for the inner engine to drain issues 19–29.
4. Run `bash scripts/p5_grade.sh` (interactive merge judgment).
5. When done: `rm reports/PILOT_IN_PROGRESS` so DONE/STOPSWITCH gates
   re-engage.

### Known issue (not addressed in this fix)

Inner-engine `select_new_task` does not re-pick issues whose credit
dropped to 65 after one failed review round (issues 20–23 in this pilot).
This is independent of the gate fix and lives in the orchestrator, which
per `CLAUDE.md` requires architect sign-off before edits. Flagged here as
a P0 follow-up — without it, P5 retry will still cap at ~6/10 completion
once the gate is open.

## Pre-existing PR worth a human look

`#30 [P5] Add dedupe_dict_list(items, key) utility` (shadow/issue-24) is
OPEN. This is the only PR produced by the pilot so far. A merge/no-merge
decision here is a legitimate data point for the merge-rate metric and
should be made by a human before discarding this run.
