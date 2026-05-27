# v2.3 Spike Theme D — Sentinel Model Tier-Down

> NEXT_PLAN_WORKBOOK §3 Phase L3 candidate.

## Problem

The M4 sentinel currently routes every soft-block re-review through
the Claude CLI subprocess — by default Haiku-grade, but the same
model every time regardless of the tool call's risk class. A
ten-line `rm -rf node_modules` and a hundred-line `sed -i ...
packages/approval-v2/src/gateway.ts` both pay the same review cost.

This shows up two ways:
1. Cost — sentinel review is ~8% of total token budget per workbook
   §3 Stage M4. A risk-class router can trim that to ~3%.
2. Latency — every soft-block adds a Haiku round-trip. For the
   "low-risk soft" class (sudo, npm-global), this is overkill.

## Hypothesis

A risk-class router in front of `LlmReviewer` can:
- short-circuit "soft-block with low signal" (e.g., `sudo` alone on
  a known-safe path) directly to `allow` based on a deterministic
  policy table, no LLM round-trip
- escalate "soft-block with adversarial signal" (e.g., sudo +
  forbidden-path-adjacent) to a tier-up review (Sonnet, not Haiku)
- pass the middle band to the current Haiku reviewer unchanged

## Smallest possible proof (spike scope)

- `RiskClassifier` in `@aedev/sentinel`:
  - input: `{ tool, args, classifyVerdict, classifyReason, context? }`
  - output: `'allow' | 'haiku' | 'sonnet' | 'opus'`
  - deterministic for unambiguous cases; falls through to `haiku` for
    ambiguous (preserves current behavior)
- Wire `ToolCallSentinel.intercept` to consult the router BEFORE
  calling `LlmReviewer`
- Demo: 100 synthetic tool calls — show that ≥ 30% bypass the LLM
  entirely (saving cost), and any prompt that's clearly adversarial
  routes to a higher tier (improving recall)
- ADR documents the policy table

## Cost / risk / feasibility

| Axis | Estimate |
|---|---|
| Token cost change / mission | -3% to -5% (router skips low-signal calls; opus tier for adversarial adds back) |
| Cost SLA impact | net negative cost — frees budget for theme A or B work |
| Surface area | 1 new class in `@aedev/sentinel`, 1 ADR, 1 policy table |
| Risk | Router false-negative — classifies an adversarial call as "low-signal allow" and skips review. Mitigation: keep all current HARD patterns in `classify()`; router only fires on soft-block path |
| Reversibility | Router takes a `mode: off | shadow | on` flag; shadow mode records what it WOULD have done without acting |

## Why this is attractive

- Hard cost-cap (GR12) buys runway for autonomous missions but
  doesn't stop scaling pressure. A 3-5% routine reduction is a long-
  game win.
- Sentinel is already isolated (its own package); the router fits
  cleanly without touching the daemon.

## Why it might NOT be picked

- Cost is not the operator's first-order concern at the moment
  (the L0 trade-off is "ship faster", not "spend less").
- Risk-class policy tables drift; the spike's first table won't be
  the right table 6 months in. Maintenance cost is real.
- Theme A (memory) probably saves MORE cost (less re-discovery) for
  less ongoing maintenance.

## Open questions for operator

- Three tiers (haiku / sonnet / opus) or two (haiku / sonnet)?
- Shadow-mode duration before going live — 7 days? 30 days?
- Who decides the policy table — same place as the sentinel
  redteam suite, or separate?
