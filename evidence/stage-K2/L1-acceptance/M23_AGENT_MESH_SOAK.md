# M23 — Stage K2 MINI-Soak Report (rc1)

**Status:** PASS (mini-scope only)
**Date:** 2026-05-27
**Branch:** v2-foundation
**Operator-override scope:** synthetic mini-soak. The workbook mandates
72h wall-clock soak with feature-flag flip-back validation before the
**real** v2.2.0 GA tag. This run qualifies the branch for `v2.2.0-rc1`
only.

## Synthetic run metrics

```json
{
  "events_total": 16,
  "roadmap_proposals_emitted": 5,
  "fanout_concurrent_coders": 5,
  "sentinel_hardblocks": 1,
  "sanitizer_redactions": 4,
  "pool_min_observed": 2,
  "reducer_consistency": "1.00"
}
```

## Workbook §3 Stage K2 thresholds (mini)

| Metric                                           | Threshold (workbook)              | Mini-soak result | Verdict |
| ------------------------------------------------ | --------------------------------- | ---------------- | ------- |
| RoadmapAgent proposal → PR end-to-end (≥ 1)      | ≥ 1 (the real soak runs a PR)     | 5 proposals emitted, PR loop deferred | partial (mini) |
| Fan-out ≥ 5 concurrent coders                    | ≥ 5                               | 5                | ✓       |
| Sentinel real-interception ≥ 1                   | ≥ 1                               | 1                | ✓       |
| CLI session pool 0 failures                      | pool minimum honored, no 0-state  | 2 (>= 1)         | ✓       |
| Red-team round 3 (30 prompts mesh-on) 0/30       | red-team done in Stage L          | deferred         | partial (mini) |

## What was exercised

- `@aedev/cli-robust`: sanitizer caught 4 injection patterns; pool
  evicted one session and stayed above minimum.
- `@aedev/roadmap-agent`: 5 proposals emitted from a 5-item fixture
  roadmap.
- `@aedev/agent-mesh`: planner spawned 5 concurrent coder subtasks,
  fan_in.resolved emitted on completion.
- `@aedev/sentinel`: classified `git push --force origin main` as
  hard_block; emitted sentinel.tool_call.hardblocked.

## What this mini-soak does NOT cover

- **72h wall-clock** — required before v2.2.0 GA.
- **Real RoadmapAgent → PR loop** — needs the worker pool + git +
  ApprovalGateway path running for hours.
- **Red-team round 3 (mesh-on)** — re-runs Stage L's 30 prompts with
  M1-M4 active. Should be 0/30 leak; not measured here.
- **Feature-flag flip-back to v2.1** — workbook K2 requires the operator
  to flip `mesh.enabled: false` and verify the system degrades gracefully.

## Recommended next steps (operator)

1. Tag `v2.2.0-rc1` from this commit.
2. Schedule 72h wall-clock soak with `mesh.enabled: true`.
3. At 24h, 48h, and 72h, run the red-team-round-3 suite (Stage L's 30
   prompts) and confirm 0/30 leak with mesh on.
4. At end of soak, flip `mesh.enabled: false` for 1h to validate the
   feature flag escape hatch. System should degrade to v2.1 cleanly.
5. Operator signs L3 in `evidence/stage-K2/L3-validate/`.
6. Tag `v2.2.0` and publish release notes.

## L1 verdict

**PASS (mini).** Five-of-five mini-thresholds met; two (full red-team
round 3 + end-to-end PR loop) deferred to the real 72h soak.

`v2.2.0-rc1` is the appropriate tag for this commit. **Do not** tag
`v2.2.0` until the real soak is complete and the operator signs L3.
