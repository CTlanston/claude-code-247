# M22c — Stage K Compressed-1-Day Soak Report (rc2 grade)

**Status:** PASS (compressed-1-day per ADR-0011 bound 2)
**Date:** 2026-05-27
**Branch:** v2-foundation
**Script:** `scripts/soak-k-full.ts`
**This report qualifies the branch for `v2.1.0-rc2`, NOT `v2.1.0` GA.**
ADR-0011 bound 1 is explicit: GA still needs a real-clock 72h soak +
operator L3 sign-off + an ADR-0012 record of that real-clock run.

## Run metrics

```json
{
  "scope": "compressed-1-day",
  "thresholds": "all_met",
  "duration_ms": 171,
  "ticks": 800,
  "events_total": 1576,
  "moves_completed": 53,
  "interrupts_injected": 80,
  "interrupts_auto_resolved": 80,
  "push_rejections": 66,
  "push_allowances": 66,
  "chaos_checkpoints": 4,
  "chaos_drills_fired": 20,
  "daemon_restart_count": 8,
  "daemon_restart_recovery_ms_p95": 7,
  "reducer_consistency": "1.00"
}
```

## Workbook §3 Stage K thresholds (compressed scope)

| Metric                                            | Threshold              | Result    | Verdict |
| ------------------------------------------------- | ---------------------- | --------- | ------- |
| moves_completed > 0                               | > 0                    | 53        | ✓       |
| interrupts_auto_resolved >= injected - 1          | ≥ N − 1                | 80 / 80   | ✓       |
| push_rejections > 0                               | > 0                    | 66        | ✓       |
| daemon_recovery_p95_sec < 90                      | < 90 s                 | 0.007 s   | ✓       |
| reducer_consistency = 1.00                        | = 1.00                 | 1.00      | ✓       |
| 4 chaos checkpoints (1 per 6h compressed)         | 4 windows × 5 drills   | 4 / 20    | ✓       |

## What was exercised

- @aedev/event-log: 1576 events appended, deduped via idempotency
  keys, replayed twice for the reducer consistency check.
- @aedev/cli-robust: SessionProbe ticked 800× including a brief
  expired-then-recovered window; QuotaTracker recorded 800 calls
  vs a 5000 daily cap.
- @aedev/interrupt-bus: 80 distinct holds opened + resolved 1:1.
- @aedev/push-policy: 132 push attempts (66 allowed + 66 denied
  via forbidden_path).
- @aedev/moves: 53 three-step sagas completed.
- @aedev/chaos: 4 windows at ticks 200/400/600/800; each fires the
  5-drill suite for a total of 20 chaos events.
- @aedev/daemon/obs: every event re-dispatched through the
  ObservabilityBus → SSE + Loki + Prometheus counter.
- Cold-restart recovery: 8 fresh FileEventLog constructions, p95
  7 ms vs 90,000 ms threshold (≈12,800× headroom).

## What this does NOT prove (still needed for v2.1.0 GA)

- Real wall-clock 72-hour continuous daemon uptime.
- Real subscription-CLI quota exhaustion paths (Stage M1 expand).
- Real network failure recovery (drop_network drill is local
  black-hole TCP; production failures involve DNS, BGP, transit).
- Operator-on-phone HOLD release latency under network jitter.

## Path from rc2 to v2.1.0 GA

1. Operator schedules a real 72h wall-clock window.
2. Run `scripts/soak-k-full.ts` once per 6 h across the window.
3. Restart the daemon ~12 times (1 per 6 h) — verify p95 < 90 s.
4. Operator signs `evidence/stage-K/L3-validate/operator-signoff.md`.
5. Author ADR-0012 recording the real-clock run + L3 sign-off.
6. Move tag `v2.1.0-rc2` → `v2.1.0`.

## L1 verdict (rc2)

PASS. Six gating metrics met under the compressed-1-day scope. Tagging
`v2.1.0-rc2` from this commit. ADR-0012 + real-clock L3 remain
prerequisites for `v2.1.0` GA.
