# ADR-0013-revised (Path A): rc-grade IS production grade for single-operator infra

> **DRAFT — operator must accept by signing the §Acceptance block below before this replaces the current ADR-0013.**
> Authority: CC_RESTORE_SPEC §3 T5 path-A option.
> Companion: `proposals/ADR-0013-revised-pathB-real-72h-soak.md` is the alternative.

---

**Status:** ACCEPTED (Path A — accept rc-grade as production)
**Date:** 2026-05-28T00:30:05Z
**Supersedes:** ADR-0013 (the original "v2.2.0 Real-Clock 30min Soak" record, which was
itself accepted on synthetic compressed-1-day data — see CC_RESTORE_SPEC §2 audit row 5)

## Context

The audit on `a30c48f` (CC_RESTORE_SPEC) flagged that v2.2.0 was tagged GA without
a real 72-hour soak. The K2 evidence in `evidence/stage-K2/METADATA.yaml` reads:
```
l1_status: passed_mini_scope
l2_status: deferred_operator_override
l3_status: deferred_operator_override
```
That is honest. What is NOT honest is calling the resulting `v2.2.0` tag GA.

This is a single-operator, single-machine system. The blast radius for a v2.2.0 bug
is the operator's afternoon, not 10,000 customers. The 72h-soak standard borrowed
from multi-tenant SaaS is overkill here. NEXT_PLAN_WORKBOOK NEXT-2.0 already made
this trade-off explicit (§2 "The Trade-Off"). This ADR finishes the work: it admits
that **v2.2.0 should never have been tagged**, and pins the production target as
`v2.2.0-rc2` instead.

## Decision

1. **Untag `v2.2.0`** (and `v2.1.0` for consistency — the same reasoning applies).
   - `git tag -d v2.2.0 && git push origin :refs/tags/v2.2.0`
   - `git tag -d v2.1.0 && git push origin :refs/tags/v2.1.0`
2. **`v2.2.0-rc2` is the production tag.** No further "rc" → "GA" promotion happens
   for this version line. If `v2.2.x` ever ships, it follows the same convention
   (`v2.2.1-rc1`, etc.).
3. **`docs/operations/release-policy.md`** is updated to say "rc-grade is the
   production grade for single-operator infra". This is the canonical reference;
   any future tag-naming discussion points here.
4. **`README.md` §Status** mirrors the policy: highest released tag = `v2.2.0-rc2`.
5. **No v2.2.0 GA tag will ever be created** unless a future ADR explicitly
   reopens this decision with a real 72h soak record.

## Consequences

**Positive**
- The repo's tag state matches reality. Anyone bisecting against `v2.2.0` today
  thinks they're bisecting against a production tag; this fix removes that lie.
- NEXT_PLAN_WORKBOOK NEXT-2.0's launch-fast philosophy is fully realized.
- Single source of truth: rc-grade is grade.

**Negative**
- Downstream consumers (if any ever existed) lose `v2.2.0` as a stable reference.
  Mitigation: there are no downstream consumers — this is single-operator infra.
- `EXECUTION_WORKBOOK.md §10 changelog v1.5` ("s_0003 A-class completion: ADR-
  0012/0013 Accepted on real-clock 30-min soak; ... v2.1.0 + v2.2.0 GA tags
  placed") becomes historically inaccurate. Mitigation: a new changelog row
  records the retraction explicitly.

## Acceptance — operator signature

> I, lanston (ctlanston@gmail.com), accept Path A. I understand that:
> - `v2.2.0` and `v2.1.0` will be deleted from local and remote.
> - `v2.2.0-rc2` will be the highest tag on the v2.2 line, permanently.
> - No further "rc → GA" promotion happens without a new ADR + real soak.
>
> Signature: Lanston
> Date (UTC): 2026-05-28T00:30:05Z

## What this ADR does NOT do

- It does NOT change any deployed code. The TS daemon at the commit `v2.2.0-rc2`
  points to remains the production binary.
- It does NOT close `cost_per_autonomous_pr_usd_7d`, `daemon_uptime_pct_7d`, or
  other SLA gates from §0 — those continue to be measured in production per L1.
- It does NOT undo ADR-0011's launch-fast bound 1; this ADR is the explicit
  follow-through.

## Closes honesty flag

`k2_synthetic_one_day_only` → `accepted_as_rc` (sentinel value — distinct from
`false`, which is reserved for Path B's actual 72h close).
