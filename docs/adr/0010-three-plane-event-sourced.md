# ADR-0010: Three-Plane, Event-Sourced Architecture for v2.1

**Status:** Accepted
**Date:** 2026-05-26
**Builds on:** [ADR-0009](0009-aedev-as-primary-control-plane.md) — aedev as primary control plane.
**Tracked by:** [EXECUTION_WORKBOOK.md §3 Stage A](../../EXECUTION_WORKBOOK.md)
**Spike:** [docs/spikes/dispatch-approval.md](../spikes/dispatch-approval.md)

---

## Context

ADR-0009 committed to `aedev` as the primary control plane and Python `claude247` as a compatibility kernel. v2.0 surfaced a P0 design defect: `claude` CLI subprocesses were spawned **in the daemon process**, so a CLI hang stalled the supervisor. Recovering required pkill loops, manual rebuilds of SQLite-derived views, and ad-hoc reconciliation between approval state in SQLite vs. the daemon's in-memory queue.

The root cause is architectural, not tactical: state lived in two places (SQLite + daemon memory), execution lived in one process (daemon + CLI), and external side effects had no idempotency contract. A bug fix on any axis leaks into the others.

We need a structure that (a) survives `kill -9` without losing causal history, (b) makes recovery O(read events.ndjson), (c) keeps the CLI risk contained to workers, and (d) lets the operator approve from a phone in under five minutes.

## Decision

v2.1 adopts a **three-plane, event-sourced** topology.

### 1. Three planes

| Plane           | Responsibility                                        | Process model                                         |
| --------------- | ----------------------------------------------------- | ----------------------------------------------------- |
| **Daemon**      | Dispatch, policy, gateways, observability             | Single long-lived TS process under launchd/systemd    |
| **Workers**     | `claude` CLI subprocesses, repo execution, evidence   | Per-task child processes; **only place CLI may run**  |
| **Operator**    | Approvals, hold release, manual override              | Phone via Dispatch + Tailscale dual-rail              |

GROUND RULE 8 is the cross-plane invariant: a `claude` CLI subprocess may run only inside a worker. The daemon process never forks one.

### 2. Event log as source of truth

A single append-only NDJSON event log (`event_log` SQLite mirror + monthly NDJSON shards) is the source of truth. SQLite tables are **derived views**, rebuildable by reducing the log from any timestamp cursor. Concretely:

- All state changes are written as events first, views second (GROUND RULE 6).
- Each event carries `(id, task_id, ts, actor, kind, idempotency, payload, causation_id, correlation_id)` (workbook §4.4).
- `idempotency` is unique across the log; duplicate side effects are detected, not replayed (GROUND RULE 5).
- Reducer round-trip is the test we ship: `replay(events) → state` must be byte-equal to the live SQLite snapshot.

### 3. Side effects gated by capability tokens

Every external write (`git push`, `gh pr create`, `ntfy`, `npm publish`, Anthropic API) requires a capability token signed by the daemon. Tokens carry an idempotency key, a 5-minute TTL, and a path/branch scope. Workers cannot bypass the gateway; the daemon refuses unsigned writes.

### 4. Approval is dual-rail from day 0

The approval gateway runs **both** Dispatch (Cloudflare Worker → ntfy → phone) **and** Tailscale (point-to-point HTMX page) transports in parallel from day 0. The spike (see linked doc) picks the day-0 default; the other is automatic fallback. This is non-negotiable because the operator-on-phone SLA (`approval_e2e_p95_min ≤ 5`) is the single largest contributor to throughput, and a transport outage is the single largest risk to that SLA.

### 5. HOLD = first-class state

Interrupts (`session_expired`, `quota_exhausted`, `secret_grant_request`, `validator_disagreement`, `production_incident`, `forbidden_path_push`, `sentinel_rejected` in v2.2) are written to the event log with a policy `{ttl, on_timeout: retry-3 | drop | escalate}`. Their resolution is also an event. Open holds gate session progress (workbook §8.3).

### 6. CLI lives in a robustness layer (Stage M1, v2.2)

The subscription CLI is fundamentally external: it can drift versions, change its output shape, exhaust quota silently, or expire keychain credentials. v2.1 ships the surface (SessionProbe + Subscription Budget in Stage B); v2.2 expands it into a full robustness layer (probe + sanitizer + pool + quota oracle).

## Consequences

**Positive**

- Daemon `kill -9` recoverable in p95 < 90s by re-reducing the log.
- Approval e2e (operator phone → daemon decision) p95 < 5 min via dual rail.
- 0 mixed-state incidents: SQLite and daemon memory are derived, not authoritative.
- Red-team prompt injections are bounded by the capability token; the worker has no push credentials by default.

**Negative / Cost**

- Every write doubles: event first, then view. Throughput halves; we accept this since the daemon is not on the hot path of any user-facing latency.
- NDJSON monthly rotation introduces a reducer edge case (Stage A.1 §3 "坑 ①"). Tests cover it.
- Dual-rail approval doubles transport ops; spike documents the operational cost.
- 7 mandatory hold reasons mean a stricter policy table than v1's free-form interruption notes.

**Out of scope (explicitly deferred)**

- Multi-daemon / clustered mode. v2.x is single-host.
- Real-time subscriptions to the event log from external consumers. SSE in Stage J is internal-only.

## How we'll know this was right

- Stage K (72h soak) reports `daemon_recovery_p95_sec < 90` over ≥ 12 forced restarts.
- Stage L (red-team round 2) reports `redteam_pass_rate = 1.00`.
- Stage K2 (v2.2 soak) reports `cli_session_pool_min ≥ 1` for the full window.

If any of those break, this ADR is superseded.
