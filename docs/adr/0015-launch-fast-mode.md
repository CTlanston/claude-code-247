# ADR-0015: Launch-Fast Mode — Same-Day Launch After 30-Minute Smoke

**Status:** Accepted
**Date:** 2026-05-27
**Builds on:** [ADR-0011](0011-operator-override-l2-l3-bypass.md), [ADR-0012](0012-v2.1-real-clock-soak.md), [ADR-0013](0013-v2.2-real-clock-soak.md), [ADR-0014](0014-approval-transport-real-sla-deferral.md)
**Tracked by:** [NEXT_PLAN_WORKBOOK.md](../../NEXT_PLAN_WORKBOOK.md) §2, §3 Phase L0

---

## Context

`EXECUTION_WORKBOOK.md` previously recorded stage-class completion as
`v2.2.0` on `main`. ADR-0013 Path A later corrected the release-grade
claim: `v2.2.0-rc2` is the production tag for this single-operator
system, and no `v2.2.0` GA tag is created under the current policy.
The natural follow-on is a multi-week pre-flight soak before
the first real autonomous mission ships. NEXT-1.0 specified that
12-week plan.

The operator pushed back on the calculus. Their argument:

- One operator, one machine, one user — themselves.
- Blast radius for a day-1 bug is "fix it tonight", not "page 10,000
  customers".
- 30-day pre-flight soak is the right answer for multi-tenant SaaS; it
  is overkill for personal infra.
- The cost of waiting is real opportunity cost (no real value for 5
  weeks); the cost of being wrong is bounded.

This ADR records the resulting decision and the operator's explicit
acceptance of the trade-offs.

## Decision

Adopt **launch-fast mode** as documented in `NEXT_PLAN_WORKBOOK.md`
v NEXT-2:

1. **Pre-flight = 30-minute smoke run.** A scripted 7-check harness
   (§3 Phase L0, the `scripts/launch-smoke.ts` orchestrator). 7/7
   green = launch authorized the same day. 6/7 = fix and re-run.
2. **Soak moves into production.** Phase L1 (7 days live fire) is
   the soak the long-form plan would have run pre-flight. The
   operator is on call.
3. **Quality bar unchanged.** All 10 GROUND RULES from
   `EXECUTION_WORKBOOK.md` still apply. Two new ones (GR11 binary
   smoke, GR12 cost cap) bound the launch-fast posture.
4. **SLA gates moved post-launch.** §0 `sla_after_launch.*` are
   measured from real telemetry on day 1+. Each carries a
   `post_launch_review` deadline (default 1 week).

The operator pre-accepts the four risk acknowledgements in
`NEXT_PLAN_WORKBOOK.md` §0 `risk_acknowledgements`. The phrasing is
copied verbatim here so this ADR is self-contained:

> - "Rare failure modes (month-boundary, real CLI version bump,
>    sustained quota near-ceiling) may surface in flight; recovery
>    is the operator's responsibility."
> - "Alerting was proven to deliver under wifi; cellular and 3am
>    responsiveness are not pre-validated."
> - "Cost ceiling is set high (see L1) but a runaway billing
>    scenario could still happen on day 1."
> - "Production data is the soak data. There is no 'staging'
>    equivalent."

## Operator acceptance statement

> I, lanston (ctlanston@gmail.com), have read NEXT_PLAN_WORKBOOK.md §2
> "The Trade-Off" and accept the four risk acknowledgements above. I
> authorize launch-fast mode for v2.2.x post-GA operations. If at any
> point the trade-offs prove wrong, I will revert to the NEXT-1.0
> 12-week soak-first plan kept in git history.

(Operator confirms by adding their dated signature to
`evidence/launch/operator-launch-signoff.md` at L0 exit. This ADR
records the intent; the signoff file records the actual launch event.)

## Consequences

**Positive**
- 5-week plan instead of 12. Time to first real autonomous PR is
  day 1 instead of week 5.
- Real telemetry from day 1 drives observability + alerting
  improvements (L2.1, L2.2). Synthetic-only metrics tuning is
  cut off.
- Operator's risk profile matches the plan — no fictional
  "multi-tenant SaaS soak" theater.

**Negative**
- Rare failure modes (the workbook §0 names month-boundary, real CLI
  version bump, sustained quota near-ceiling) may surface in flight.
- The "we proved it pre-launch" story is given up. Any day-1 incident
  has no clean defensive narrative beyond "the operator chose the
  trade-off explicitly".
- Cellular alerting is not pre-validated. If the operator is off-wifi
  during the first incident, response time may exceed
  `hold_mttr_p95_min_7d: 30 min`.

**Recovery path** Revert is always available:
1. `git checkout main && git revert <launch-fast-merge>`
2. Or: drop down to `mesh.enabled=false` and resume v2.1 single-plane
   operation while the longer soak is run.
3. Or: restart from `NEXT_PLAN_WORKBOOK.md @ NEXT-1.0` (recoverable
   from git history).

## What this ADR explicitly does NOT change

- **GROUND RULES 1–10** stay verbatim. The two new rules (GR11, GR12)
  are additive.
- **Three-tier L1/L2/L3 contract** stays. The L0 smoke + L1 live fire
  + L2 maturity + L3 spike phases all still pass through L1+L2+L3.
- **ADR-0013 Path A release-grade correction** remains valid. This ADR
  does not promote `v2.2.0-rc2` to a GA tag and does not create `v2.1.0`
  or `v2.2.0`.
- **Stage M rollback path** still works. Feature flag
  `mesh.enabled` flips remain the documented rollback mechanism.

## How we'll know this was right

Three SLAs from `NEXT_PLAN_WORKBOOK.md §0 sla_after_launch.*`:

- `autonomous_pr_success_rate_7d ≥ 0.5` — at least half of attempted
  autonomous missions complete end-to-end without operator intervention.
- `cost_per_autonomous_pr_usd_7d ≤ 8.0` — and `≤ 15.0 hard cap`.
- `hold_mttr_p95_min_7d ≤ 30 min` — operator can react within the SLA
  even from a phone.

If any of those misses during L1 Gate G2 review, this ADR
re-opens and the operator decides whether to extend launch-fast
beyond week 1 or fall back.

## Open items this ADR does NOT close

- ADR-0014's deferred `approval_e2e_p95_min < 5 min` measurement —
  still post-GA hardening; no change.
- The L3 spike theme decision — operator picks one of four themes at
  Gate G3 (Phase L3 exit) — no commitment in this ADR.
- The v2.3 scope itself — same.
