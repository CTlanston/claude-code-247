# v2.3 Spike Theme B — Multi-Repo Missions

> NEXT_PLAN_WORKBOOK §3 Phase L3 candidate.

## Problem

A mission today targets exactly one repo (the one the daemon was
installed into). Real-world tasks routinely span repos: "deduplicate
the auth helper between repo-A and repo-B", "bump the shared
@aedev/event-log version in every downstream", "audit secrets policy
across all five product repos".

## Hypothesis

The single-repo assumption is implicit, not architectural. The
event-log, mesh, sentinel, and approval surfaces are all
identifier-keyed (taskId, missionId), not path-keyed. Adding a
RepoRegistry that maps `repo_id → clone_path + default_branch +
forbidden_paths` and threading `repo_id` through the existing event
schema would unlock cross-repo missions without rewriting the core.

## Smallest possible proof (spike scope)

- New `packages/repo-registry/`:
  - `RepoRegistry.add(spec)`, `.get(id)`, `.list()`
  - Persisted to `~/.claude-code-247/repos.yaml` (the v1 file the
    workspace already knows about — same shape, new API)
- Extend `EventLog.append` schema (additively, GR4) with optional
  `repo_id` on events that have one
- Demo: Planner spawns 2 Coders, one targeting repo-A, one repo-B,
  both completing to PRs. Single mission, two PR URLs in the event
  log, both passed sentinel + cap-token.
- ADR documents the cross-repo capability-token scope (token still
  binds to one branch in one repo; mission orchestrates multiple
  tokens).

## Cost / risk / feasibility

| Axis | Estimate |
|---|---|
| Token cost / mission | ~2x for 2-repo mission (mostly parallel) |
| Cost SLA impact | within budget — still well below $15/PR cap |
| Surface area | 1 new package, 1 schema delta (additive), 1 ADR |
| Risk | Forbidden-path leakage across repos — repo-A's secrets/ path getting touched by a coder spawned for repo-B. Mitigation: cap-token's `branch` field already scopes per-repo |
| Reversibility | Schema delta is additive; rollback = stop spawning multi-repo missions; existing missions unaffected |

## Why this is attractive

- Operator-tangible: a single mission can refactor across the whole
  fleet of repos they manage.
- Maps cleanly onto existing primitives — no new GR class to violate.

## Why it might NOT be picked

- Doubles the surface area of every Coder invocation; sentinel and
  cap-token policies have to be re-validated per-repo.
- Without persistent memory (theme A), each cross-repo coder
  re-discovers context twice per mission — token cost compounds.

## Open questions for operator

- How many concurrent repos in one mission? 2 max for v2.3, or
  open-ended?
- Does the mesh's RoadmapAgent scan ALL registered repos, or one
  primary + opt-in fanout?
- Forbidden-path policy: per-repo union, or global intersection?
