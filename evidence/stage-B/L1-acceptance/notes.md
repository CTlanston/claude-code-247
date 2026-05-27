# Stage B — L1 Acceptance Notes

**Session:** s_0002 · 2026-05-26
**Branch:** v2-foundation
**Outcome:** PASSED (4/4 explicit acceptance criteria; 1 partial exit criterion noted)

## Acceptance criteria (workbook §3 Stage B)

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | mock keychain failure → HOLD within 15 min | ✓ | `probe.test.ts` case 3 |
| 2 | mock 1000 calls → `HOLD-quota-exhausted` | ✓ | `probe.test.ts` case 8 |
| 3 | ≥ 8 unit tests | ✓ exceeded (11) | `pnpm-test.txt` |
| 4 | `session_health` view derivable from events | ✓ | `health-reducer.ts` + case 10 / case 11 |

## Stage B acceptance command

```
pnpm vitest run packages/cli-robust
```

Result: 11/11 in `pnpm-test.txt`.

## Events emitted (per workbook §3 Stage B deliverable list)

- `cli.session.probed` — every tick
- `cli.session.expired` — every tick where probe.ok=false (causation_id → preceding `cli.session.probed`)
- `cli.quota.threshold` — first cross of `warnAtFraction`
- `hold.policy.created` (payload.reason="session_expired") — after 15min grace window
- `hold.policy.created` (payload.reason="quota_exhausted") — when callsToday ≥ dailyLimit

## Naming normalization

Workbook §3 Stage C lists hold events as two-segment shorthand
(`hold.created / .resolved / ...`), but §4.4 specifies the
`<area>.<thing>.<verb>` regex (three segments). The L2 reviewer of Stage A
implicitly chose three-segment in their injection script
(`hold.policy.created`). Stage B follows the same: emit
`hold.policy.created` with `payload.reason` distinguishing
`session_expired` vs `quota_exhausted` vs (future) `validator_disagreement`
etc.

A workbook amendment proposal under §7.4 would lock this in; deferred.

## Stage exit criterion delta

Workbook §3 Stage B exit: "心跳与配额都能从事件日志重建".

- Heartbeat (session_health): **fully rebuilt from events alone** — the
  reducer is a pure function over `cli.session.probed` and
  `cli.session.expired` events. Verified in case 11.
- Quota: **partially rebuilt**. Threshold and exhaust transitions are
  events; the per-call counter is in-memory only (no
  `cli.quota.usage.recorded` event per call — that'd be 1000+
  events/day/task). A QuotaTracker restarted mid-day would lose its
  counter but would correctly recover the warned/exhausted booleans
  from the most recent threshold/hold event.

This is a Stage B.exit follow-up or a Stage M1 expansion (per workbook
§3 Stage M1 deliverable list, `quota` oracle gets the ±5% accuracy
treatment there). Not a Stage B L1 blocker per the explicit acceptance
criteria, but flagged as a gap.

## Cross-cutting checks (workbook §4)

- §4.1 — No `.only`, no `.skip` introduced. Unit tests < 20ms each.
- §4.2 — Commits: `[B.0]` hygiene, `[B.1]` package, will close with
  `[B.exit]` evidence + state advance.
- §4.4 — All emitted events conform to the three-segment kind regex,
  carry idempotency keys, populate causation_id where appropriate.
- §4.5 — Hold events keyed by `(task_id, hold.policy.created, reason,
  anchor)` so repeated ticks during the same condition do not double-open.
- §4.6 — No swallowed exceptions. Probe failures are observed via the
  probed-event payload, not exceptions.

## Self-check against §1 GROUND RULES

| Rule | Status |
|------|--------|
| 1. Never skip acceptance | ✓ Ran cli-robust + typecheck |
| 2. Single stage per commit | ✓ `[B.0]` hygiene, `[B.1]` package, `[B.exit]` evidence are separate commits |
| 3. Architecture changes → ADR | n/a — Stage B is implementation of ADR-0010 §5 (HOLD as event) |
| 4. Schema dual-compat | n/a — no schema changes |
| 5. Side effects need idem keys | ✓ Hold opens are anchor-keyed; threshold is day-keyed |
| 6. Event before view | ✓ Probe/quota emit events; session_health reducer is the view |
| 7. No irreversible ops | ✓ No git rm / rm -rf / DROP TABLE |
| 8. CLI in workers only | ✓ ProbeFn is injected; daemon-side use spawns nothing |
| 9. Read §0 / update §0+§9 at exit | ✓ Boot read in s_0002; exit update queued |
| 10. Don't modify §1 | ✓ Unchanged |
