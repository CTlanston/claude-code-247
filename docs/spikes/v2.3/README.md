# v2.3 Spike Themes — Operator Picks One

> NEXT_PLAN_WORKBOOK §3 Phase L3 Gate G3. Operator picks **exactly 1**
> theme at end of week 5. The picked theme's spike opens on
> `spike/<theme>` branch (does NOT merge to main; that's a future
> NEXT_NEXT workbook).

## Themes

| Letter | Theme | One-pager | Operator hint |
|---|---|---|---|
| A | Persistent memory across missions | [persistent-memory.md](./persistent-memory.md) | Highest cost-saving / least new infra |
| B | Multi-repo missions | [multi-repo.md](./multi-repo.md) | Biggest capability unlock |
| C | Operator-as-Reviewer in-loop | [operator-as-reviewer.md](./operator-as-reviewer.md) | Cheapest, addresses trust |
| D | Sentinel model tier-down | [sentinel-tier-down.md](./sentinel-tier-down.md) | Cost optimization, long-game |

## How to decide

Score each across the 4 axes ↓ in the per-theme doc:
- Feasibility (engineering hours to ship the spike)
- Cost impact on §0 `cost_per_autonomous_pr_usd_7d`
- Risk on §1 GROUND RULES + ADRs
- Surface area (packages/files touched)

Then ask:
- Which of these would I most regret NOT having in 3 months?
- Which builds on the other three the most?

## Decision artifact

Operator's choice + reasoning goes in
`docs/adr/0020-v2-3-scope.md`. Workbook §0 then updates
`current_phase` to a v2.3-Stage-A handoff. If operator declares
maintenance mode instead, ADR-0020 is renamed
`0020-maintenance-mode.md` and NEXT_PLAN_WORKBOOK closes.

## What this README intentionally does NOT do

- Recommend a theme. The agent has opinions (e.g., theme A has the
  best cost/value ratio for token spend), but the operator's view of
  *risk appetite* and *most-regret-not-having* is the deciding lens,
  not the agent's.
- Lock the theme list. If the operator adds a fifth theme during the
  spike week, write a new one-pager and add it to this README.
