# Spike: Default Transport for Approval Gateway

**Owner:** v2-foundation
**Date:** 2026-05-26
**Status:** Conclusion — *Tailscale point-to-point is the day-0 default; Dispatch is the failover.*
**Decided by:** ADR-0010 (this spike is the experimental record behind it).
**Tracked by:** EXECUTION_WORKBOOK.md §3 Stage A, Stage D.

---

## Question

ADR-0010 requires the approval gateway to run **both** Dispatch (Cloudflare Worker → ntfy → phone) and Tailscale (HTMX page over the user's tailnet) from day 0. Both transports are wired in Stage D. The one open question is which transport the system *prefers* — i.e., which is "primary" and which is the silent fallback.

The acceptance SLA is hard: `approval_e2e_p95_min ≤ 5`. That measures the time from "daemon emits `approval.requested`" to "daemon receives `approval.decided`". A wrong primary cleanly within the SLA is fine; a wrong primary that flips fallback paths under partial outages is not.

## Options compared

| Axis                            | Dispatch (CF Worker + ntfy)             | Tailscale (HTMX direct)                          |
| ------------------------------- | --------------------------------------- | ------------------------------------------------ |
| External dependencies           | Cloudflare, ntfy.sh                     | Tailscale (already running on operator phone)    |
| Cold-path latency (p50)         | 1.5–3 s (push notification round trip)  | 0.3–0.8 s (HTTP on the LAN/tailnet)              |
| Hot-path latency (operator awake) | 30–90 s phone-tap-to-decision         | 20–60 s phone-tap-to-decision                    |
| Failure modes                   | CF outage, ntfy degraded, push throttled | Tailnet down, phone wifi off, NAT change         |
| Auth model                      | HMAC token in URL                       | Tailscale ACL + HMAC token                       |
| Operator UX                     | Pushed; "wake to act"                   | Pulled; "open page to act"                       |
| Day-0 ops cost                  | CF + ntfy account + key rotation        | Tailscale ACL + HMAC key only                    |

## Empirical signal

We ran two synthetic loops on 2026-05-26 morning, each 25 cycles of "daemon emits → human acknowledges within 5 min":

**Dispatch loop:**
- 25/25 delivered. p50 = 2.4 s for notification, p95 = 4.8 s. Operator-tap-to-decision p95 = 78 s.
- One cycle the push arrived 4 minutes late (ntfy was bursty); within SLA but a warning.

**Tailscale loop:**
- 25/25 delivered. p50 = 0.6 s page load, p95 = 1.2 s. Operator-tap-to-decision p95 = 56 s.
- Two cycles required the operator to manually open the page (no push); when measured as "from daemon emit to manual page open" this added ~120 s for those two cycles.

**Hybrid loop (Tailscale primary, Dispatch as a 90-s timeout fallback for "haven't opened the page yet"):**
- 25/25 delivered. p95 end-to-end = 71 s. No tail anomalies.

## Conclusion

**Tailscale is the day-0 default.** Reasons:

1. Lower p50 by a factor of ~4.
2. Fewer external dependencies; CF or ntfy outage no longer endangers the SLA.
3. Already in the operator's existing daily-use stack — no new auth-paste step.
4. Dispatch is still wired and active. We use it as a "wake-up" channel: if the daemon hasn't seen the operator open the Tailscale page within 90 s, it sends the Dispatch push. The operator decides on whichever rail arrives first.

**Failure mode contract.** If Tailscale fails its health probe (5 consecutive 5xx or timeouts) the gateway flips the default to Dispatch automatically and emits `approval.transport.failover` to the event log. The operator is notified once per flip via Dispatch. A flip-back also emits its own event.

## Where this lands in code (Stage D)

```
packages/approval-v2/src/
  gateway.ts             // orchestrator, picks primary transport per request
  tailscale-transport.ts // primary
  dispatch-transport.ts  // failover + wake-up rail
  token.ts               // HMAC + idempotency
  htmx-ui.ts             // Tailscale page
```

Config (`config.yaml`):

```yaml
approval:
  transport: tailscale       # default; "dispatch" also valid
  fallback: dispatch
  tailscale:
    listen: 0.0.0.0:7248
    base_url: https://laptop.tail-XXXX.ts.net
  dispatch:
    ntfy_topic: claude247-${operator_id}
    cf_worker_url: https://dispatch.claude247.dev/approval
  wakeup_timeout_seconds: 90
```

## Open follow-ups (not blocking Stage A exit)

- **F1**: Migrate the legacy `approval.ts` callers to use the new gateway via a feature flag (`approval.use_v2_gateway: false` by default until Stage D L3 passes).
- **F2**: Add a `ntfy` retry queue so a 4xx from the CF Worker does not silently drop the rail.
- **F3**: When the operator is on the same LAN as the daemon, bypass Tailscale entirely and serve directly. This is an optimization only — skip for v2.1.

## What would invalidate this conclusion

- Tailscale tail latency creeps past 1.0 s p95 → re-spike, possibly invert defaults.
- Operator reports "I rarely open the Tailscale page proactively" — would mean Dispatch's wake-up rail is doing the actual work; we should make it primary.
- Stage K soak shows ≥ 1 missed `approval.requested` due to Tailscale unreachability that Dispatch did not paper over → re-spike + audit failover code path.
