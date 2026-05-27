# v2.3 Spike Theme C — Operator-as-Reviewer In-Loop

> NEXT_PLAN_WORKBOOK §3 Phase L3 candidate.

## Problem

L3 review today is async: the operator looks at evidence + L1
artifacts after the agent session is done. For high-stakes missions
(production-incident class, GR-touching, or unusually-large diff),
async review is the wrong mode — the operator wants to be **inside**
the loop, not outside it.

The mesh has no way to say "this particular mission needs sync
operator-as-Reviewer before merge".

## Hypothesis

Introduce an optional `requires_sync_review: true` flag on a
mission_spec. When set, the Reviewer agent's verdict becomes
provisional; the actual merge requires a separate
`approval.review.received` from the operator's phone (same ntfy +
Tailscale path as approval gateway). The mission pauses at the
"PR open, awaiting human review" state, surfaced as a HOLD with
reason `operator_review_required` (new HoldReason — GR4-compliant
addition).

## Smallest possible proof (spike scope)

- New HOLD reason `operator_review_required` in `@aedev/interrupt-bus`
  (Infinity TTL, halt — same shape as `production_incident`).
- Optional flag `requires_sync_review` on mission_spec (additive).
- Mesh check: when this flag is set, suspend after Reviewer's
  approval and surface a HOLD. ApprovalGateway already handles the
  phone notification; we just route the response into a new event
  `mission.sync_review.received`.
- Demo: 1 mission with `requires_sync_review: true` reaches PR but
  doesn't merge; operator's phone approve triggers merge.

## Cost / risk / feasibility

| Axis | Estimate |
|---|---|
| Token cost | none — pure orchestration change |
| Cost SLA impact | zero |
| Surface area | 1 HoldReason addition, 1 mission_spec field, 1 mesh state, 1 ADR |
| Risk | Operator becomes the bottleneck for the missions they marked sync. Mitigation: explicit flag — operator opted in; default stays async |
| Reversibility | Add the flag as `false` default. Disabling = stop setting the flag |

## Why this is attractive

- Cheapest theme by token budget.
- Highest psychological win for an operator who feels "I'm watching
  the system from outside but I can't intervene before it acts".
  Sync review is the intervention surface.
- Directly addresses the ADR-0011 risk acknowledgement
  "Production data is the soak data" — high-risk missions can be
  gated by the operator's wall-clock judgment.

## Why it might NOT be picked

- Doesn't unlock new capability — just adds friction to a path that
  already works. If trust in async review is already high, this is
  process for its own sake.
- Pushes more notifications onto the operator's phone — competes with
  the L1 SLA goal of "every notification useful".

## Open questions for operator

- What's the default heuristic for setting the flag? (any merge to
  main? any forbidden_path adjacency? any diff > 200 LoC?)
- Should the Reviewer agent emit a "needs human review" recommendation
  the operator can override, instead of binary flag?
- Latency budget — how long can a mission sit pending review before
  it's auto-aborted?
