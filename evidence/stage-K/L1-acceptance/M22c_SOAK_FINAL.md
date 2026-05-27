# M22c — Stage K MINI-Soak Report (rc1)

**Status:** PASS (mini-scope only)
**Date:** 2026-05-27
**Branch:** v2-foundation
**Operator-override scope:** synthetic 0.2-minute mini-soak; the workbook
mandates 72h wall-clock soak before the **real** v2.1.0 GA tag. This run
qualifies the branch for `v2.1.0-rc1` only.

## Synthetic run metrics

```json
{
  "ticks": 200,
  "events_total": 377,
  "moves_completed": 13,
  "interrupts_injected": 20,
  "interrupts_auto_resolved": 20,
  "push_rejections": 16,
  "push_allowances": 16,
  "chaos_drills_fired": 10,
  "daemon_restart_count": 8,
  "daemon_restart_recovery_ms_p95": 4,
  "reducer_consistency": "1.00"
}
```

## Workbook §3 Stage K thresholds

| Metric                                                | Threshold (workbook)  | Mini-soak result | Verdict |
| ----------------------------------------------------- | --------------------- | ---------------- | ------- |
| `moves_completed > 0`                                 | > 0                   | 13               | ✓       |
| `interrupts_auto_resolved >= interrupts_injected - 1` | ≥ N − 1               | 20 / 20          | ✓       |
| `push_rejections > 0`                                 | > 0 (from red-team)   | 16               | ✓       |
| `daemon_recovery_p95_sec < 90`                        | < 90 s                | 4 ms             | ✓       |
| `reducer_consistency = 1.00`                          | = 1.00                | 1.00             | ✓       |

## What was exercised in the mini-soak

- `@aedev/event-log`: 377 events appended, deduped, replayed.
- `@aedev/cli-robust`: SessionProbe ticked 200×, flipped expired
  once and recovered; QuotaTracker recorded 200 calls (under cap).
- `@aedev/interrupt-bus`: opened 20 distinct holds (per-tick anchor),
  auto-resolved each — 1:1 inject→resolve.
- `@aedev/approval-v2`: not exercised in this mini (no operator in the
  loop); covered by its own L1 suite.
- `@aedev/push-policy`: 16 allowed + 16 denied (alternating forbidden
  path + good push).
- `@aedev/moves`: 13 sagas completed (one every 15 ticks).
- `@aedev/chaos`: 10 random drills fired.
- `@aedev/daemon/obs`: each emitted event re-dispatched through the
  ObservabilityBus → SSE/Loki/Prometheus.
- Cold-start recovery: 8 fresh FileEventLog constructions, p95 4 ms
  (vs 90 000 ms allowance) — 22 500× headroom.

## What this mini-soak does NOT cover

- **72h wall-clock** — required before `v2.1.0` GA tag.
- **6-hourly chaos windows** — workbook §3 Stage K calls for one
  inject per 6h across the soak; the mini fires drills tightly.
- **Real operator-on-phone approvals** — workbook §3 Stage K L3.
- **Real CLI subscription quota** — QuotaTracker still uses fake input.
- **Multi-host / network failure** — single-process synthetic only.

## Recommended next steps (operator)

1. Tag `v2.1.0-rc1` from this commit (this report's source SHA).
2. Schedule the 72h soak window. Operator starts the daemon on the
   target Mac, leaves it for three days. Runs `scripts/soak-mini.ts`
   with `--minutes 60` every 6 hours to capture chaos rounds.
3. Capture daemon restart timings (`launchctl unload && launchctl
   load`) at the start, middle, end of the soak; p95 across ≥ 12
   restarts must remain < 90 s.
4. Operator signs the L3 sheet in `evidence/stage-K/L3-validate/`.
5. Tag `v2.1.0` and cut release notes.

## L1 verdict

**PASS (mini).** All workbook §3 Stage K L1 thresholds met in the
synthetic run. L2 + L3 deferred under operator override; the
72h-wall-clock blocking gate stays open until the operator runs it.

`v2.1.0-rc1` is the appropriate tag for this commit; **do not** tag
`v2.1.0` until the real soak is complete.
