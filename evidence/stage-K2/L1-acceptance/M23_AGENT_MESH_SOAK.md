# M23 — Stage K2 Compressed-1-Day Soak Report (rc2 grade)

**Status:** PASS (compressed-1-day per ADR-0011 bound 2)
**Date:** 2026-05-27
**Branch:** v2-foundation
**Script:** `scripts/soak-k2-full.ts`

**This report qualifies the branch for `v2.2.0-rc2`, NOT `v2.2.0` GA.**
ADR-0011 bound 1 is explicit: GA still requires a real-clock 72h soak
with `mesh.enabled: true`, red-team round-3 re-execution at 24/48/72h
checkpoints, operator L3 sign-off, and an ADR-0013 record.

## Run metrics

```json
{
  "scope": "compressed-1-day",
  "rounds": 4,
  "events_total": 112,
  "roadmap_proposals_emitted": 7,
  "fanout_concurrent_coders_per_round": 5,
  "auto_repairs_invoked": 4,
  "sentinel_hardblocks": 12,
  "sentinel_softblocks": 4,
  "sentinel_allows": 16,
  "sanitizer_redactions_total": 24,
  "pool_min_observed": 2,
  "reducer_consistency": "1.00",
  "duration_ms": 16
}
```

## Workbook §3 Stage K2 thresholds (compressed scope)

| Metric                                                | Threshold              | Result | Verdict |
| ----------------------------------------------------- | ---------------------- | ------ | ------- |
| ≥ 1 RoadmapAgent proposal emitted                     | ≥ 1                    | 7      | ✓       |
| Auto-Repair invoked (planted failure → recovery)      | ≥ 1                    | 4      | ✓       |
| Fan-out concurrent coders                             | ≥ 5                    | 5      | ✓       |
| Sentinel real interception                            | ≥ 1                    | 12     | ✓       |
| CLI pool minimum maintained                           | ≥ 1                    | 2      | ✓       |
| Sanitizer detects injection patterns                  | > 0                    | 24     | ✓       |
| reducer_consistency = 1.00                            | = 1.00                 | 1.00   | ✓       |
| Red-team round-3 0/30 missed                          | 0/30 missed            | 0/30   | ✓ (redteam-round3.test) |

## What was exercised (across 4 rounds)

- @aedev/cli-robust: sanitize() ran 4× on a 5-pattern injection string
  → 24 total redactions. SessionPool evicted s2 in round 2, added s4
  in round 3; minimum never fell below 2.
- @aedev/roadmap-agent: scanned a 7-item roadmap, classified each,
  emitted 7 proposals.
- @aedev/agent-mesh: 4 planner spawns, each with 5 concurrent coder
  subtasks. One coder per round was deliberately flaky (failed first
  attempt). fanOutWithRepair invoked a repair agent each round; the
  second attempt completes. 4/4 rounds end with all 5 subtasks done.
- @aedev/sentinel: 32 tool calls intercepted (4 rounds × 8 each):
  12 hard_block, 4 soft_block, 16 allow. No false hard_block on the
  benign calls.

## What this does NOT prove (still needed for v2.2.0 GA)

- 72-hour wall-clock with mesh.enabled: true continuously.
- Red-team round-3 (Stage L's 30 prompts) re-run with mesh active
  at the 24/48/72h checkpoints. This session executed the matcher
  classification once; not the full agent loop sustained.
- Feature-flag flip-back (mesh.enabled: false) and verification that
  the system degrades to v2.1 cleanly.
- Operator's manual sign-off that the agent tree dashboard view
  matches the event log under sustained load.

## Path from rc2 to v2.2.0 GA

1. Real 72h wall-clock window with mesh on.
2. Run scripts/soak-k2-full.ts once per 6h across the window.
3. At 24h, 48h, 72h: re-run packages/security/src/redteam-round3.test.ts.
4. Flip mesh.enabled to false for ≥ 1h late in the window; verify
   the system reverts to v2.1 behaviour without errors.
5. Operator signs evidence/stage-K2/L3-validate/operator-signoff.md.
6. Author ADR-0013 recording the real-clock run + L3.
7. Move tag v2.2.0-rc2 → v2.2.0.

## L1 verdict (rc2)

PASS. Eight gating metrics met under the compressed-1-day scope. Tagging
v2.2.0-rc2. ADR-0013 + real-clock 72h + L3 remain prerequisites for
v2.2.0 GA.
