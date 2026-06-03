# Parked Packages

`WORKBOOK_v3.md` treats the conversational cockpit as the product path. The
packages below are intentionally parked: they may have tests and useful code,
but they are experimental, not wired into the Simple Cowork product flow, and
must not be extended as product-critical infrastructure unless a later phase
explicitly revives them with an ADR.

| Package / area | Status | Notes |
| --- | --- | --- |
| `packages/agent-mesh` | Experimental, parked | Possible P6 fan-in/DAG reference only. |
| `packages/sentinel` | Experimental, parked | Budget/policy experiments are not in the v3 cockpit loop. |
| `packages/chaos` | Experimental, parked | Drill tooling remains outside the product path. |
| `packages/moves` and `packages/daemon/src/moves` | Experimental, parked | May be considered for P6 DAG work only after ADR approval. |
| `packages/shadow` | Experimental, parked | Shadow-run comparison is not part of v3 acceptance. |
| `packages/supervisor` | Experimental, parked | Runtime supervision is not wired into Simple Cowork. |
| `packages/interrupt-bus` | Experimental, parked | Interruption experiments stay out of the conversational cockpit. |
| `packages/push-policy` | Experimental, parked | Remote write behavior is gated by the daemon Draft PR gate. |
| `packages/approval-v2` and `packages/daemon/src/approval-v2` | Experimental, parked | Current approvals remain in the daemon/operator routes. |
| `packages/cli-robust` | Experimental, parked | CLI health experiments do not define the product path. |
| `packages/security` | Experimental, parked | Security experiments are not wired into v3 acceptance. |

Revival rule: a parked package can be used only when the active phase names it,
the operator approves the scope, and the wiring is documented before product
behavior depends on it.
