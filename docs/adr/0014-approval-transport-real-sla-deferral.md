# ADR-0014: Defer Real ntfy/Tailscale Approval SLA Measurement to Post-GA Hardening

**Status:** Accepted
**Date:** 2026-05-27
**Builds on:** [ADR-0010](0010-three-plane-event-sourced.md), [ADR-0011](0011-operator-override-l2-l3-bypass.md), [ADR-0012](0012-v2.1-real-clock-soak.md), [ADR-0013](0013-v2.2-real-clock-soak.md)
**Tracked by:** [EXECUTION_WORKBOOK.md §0 SLA](../../EXECUTION_WORKBOOK.md)

---

## Context

The workbook SLA `approval_e2e_p95_min < 5` was originally intended to
be measured against real ntfy + Tailscale operator traffic during the GA
window. The implementation has green mock/stub coverage for
Tailscale/Dispatch approval behavior, failover, token verification, and
proposal approval flow, but no 25-cycle real phone/Tailscale latency run
has been recorded.

ADR-0012 and ADR-0013 accepted the operator-revised 30-minute real-clock
soak standard for v2.1.0 and v2.2.0 GA. Those soaks did not exercise real
ntfy + Tailscale approval latency.

## Decision

The real ntfy + Tailscale `approval_e2e_p95_min < 5` measurement is not a
retroactive blocker for the already-accepted v2.1.0/v2.2.0 GA tags. It is
now a **post-GA hardening gate**.

The hardening gate passes only when all of the following evidence exists:

- 25 real approval cycles using the operator's phone path.
- Tailscale primary path measured end-to-end from approval request emit to
  approval decision receipt.
- Dispatch/ntfy wake-up or fallback path observed at least once, or a
  written note explaining why no fallback was triggered during the run.
- p95 latency < 5 minutes.
- Raw timing evidence saved under `evidence/approval-e2e/`.

## Consequences

**Positive**
- Keeps the GA record aligned with what was actually measured.
- Avoids implying that mock approval tests prove real phone-network
  latency.
- Preserves the SLA as a real operational requirement instead of deleting
  it.

**Negative**
- A future hardening run still needs operator phone participation.
- Transport regressions in real ntfy/Tailscale latency remain possible
  until that run is complete.

## Follow-up

Create an operator-run harness or runbook for 25 approval cycles and
record the resulting p95 under `evidence/approval-e2e/`.

Signature: Prepared by Codex; Lanston signature required.
