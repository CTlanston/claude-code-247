# v2.3 Spike Theme A — Persistent Memory Across Missions

> NEXT_PLAN_WORKBOOK §3 Phase L3 candidate. One-pager so the operator
> can rank vs. the other three themes at Gate G3.

## Problem

RoadmapAgent currently re-discovers context every cycle:
- the roadmap.md scan starts from scratch
- prior proposals' acceptance history isn't surfaced when grading a
  new candidate
- the Coder can't refer to "last time we touched this file, the
  reviewer flagged X"

The result: agents waste tokens re-establishing what was already
known, and small recurring patterns (e.g., "this repo prefers
zod-not-yup") are not preserved as constraints.

## Hypothesis

A pure-event-sourced persistent memory layer over `@aedev/event-log`,
projected through the existing reducer pattern, can carry context
across mission boundaries without changing GR6 ("state changes write
event first, view second"). Agents read the view at spawn; their
outputs (decisions, lessons) are emitted as events the next view
reduces over.

## Smallest possible proof (spike scope)

- New package `@aedev/memory` with two surfaces:
  - `MemoryProjection`: reduces `mission.lesson.recorded`,
    `proposal.classified.accepted/rejected`, and code-review
    decisions into a small text bundle (≤ 4k tokens).
  - `MemoryWriter`: typed wrapper around `EventLog.append` for the
    above kinds.
- One demo run: a fresh RoadmapAgent invocation receives the bundle as
  prompt context and explains how it changed at least one
  classification it would otherwise have made the same way.
- ADR documents the memory budget (max bundle size, retention policy).

## Cost / risk / feasibility

| Axis | Estimate |
|---|---|
| Token budget impact / mission | +1k–4k input tokens per agent spawn |
| Cost impact / mission | ~$0.01–$0.05 with sonnet-4-6 pricing (well under §0 cost SLAs) |
| Surface area | 1 new package, 1 ADR, 0 GR changes |
| Risk | Memory drift / staleness — bundle could carry bad info forward. Mitigation: every event in the bundle carries a TTL; reducer skips expired |
| Reversibility | Pure-additive; can be disabled via config flag and roll back instantly |

## Why this is the most attractive theme

- Highest ratio of cost-saving (less re-discovery) to engineering work.
- Builds DIRECTLY on the event-log substrate that GA was built around;
  no new infra.
- Operator-tangible win: "the system remembers what you told it last
  week".

## Why it might NOT be picked

- Spike-quality memory could give false confidence — RoadmapAgent might
  trust a hallucinated lesson. The Sentinel doesn't help here because
  this is a *proposal-time* quality issue, not a tool-call issue.
- If multi-repo (theme B) lands first, the memory model has to handle
  cross-repo contamination — designing memory for one repo and then
  retrofitting is more work than designing it once.

## Open questions for operator

- Should memory be per-repo, per-mission-class, or global?
- TTL default: 30 days? 90? Forever-until-superseded?
- Bundle format: free-text rolling summary, structured JSON, both?
