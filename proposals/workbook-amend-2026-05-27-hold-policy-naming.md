# Workbook Amendment Proposal · hold.* 3-Segment Naming

**Date:** 2026-05-27
**Author:** session s_0002 (under ADR-0011 bound 4)
**Per:** EXECUTION_WORKBOOK §7.4 update protocol
**Affects:** §3 Stage C deliverables; §8.1 reason table (no semantic change); §4.4 KIND_PATTERN (no change, this aligns prose with the existing regex).
**Status:** DRAFT — awaiting reviewer + operator dual sign-off per §7.2.

---

## Motivation

Workbook §3 Stage C says:

> 事件 `hold.created / .resolved / .escalated / .dropped`

These are **2-segment** kind strings. But §4.4 §"Event Log 规范" says
every kind matches `<area>.<thing>.<verb>` — a **3-segment** structure
— and the appender enforces this via Zod:

```ts
// packages/event-log/src/types.ts
export const KIND_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/
```

This inconsistency was discovered in session s_0002 while implementing
Stage C. The Stage A L2 reviewer's injection script already used the
3-segment form (`hold.policy.created`). Stage C and every subsequent
stage normalized to 3-segment. The workbook prose still reads 2-segment.

Without an amendment, future readers may write 2-segment kinds in good
faith and get blown up by Zod.

## Proposal

Replace the §3 Stage C event-list line with the 3-segment form, and add
an explicit cross-link to §4.4.

### Current §3 Stage C wording (excerpt)

> **交付** `packages/interrupt-bus/src/{repository,service,policy,escalator}.ts`；事件 `hold.created / .resolved / .escalated / .dropped`；`~/.claude-code-247/logs/holds.md` 同步写。

### Proposed §3 Stage C wording

> **交付** `packages/interrupt-bus/src/{repository,service,policy,escalator}.ts`；事件 `hold.policy.{created, resolved, escalated, dropped, retried}` (3-segment per §4.4)；`~/.claude-code-247/logs/holds.md` 同步写。

### Additional canonical kind list (new sub-section under §4.4 or as §4.4.1)

To prevent future drift, append a "Canonical kinds" table to §4.4:

| Subsystem        | Kinds                                                                                                  | Source package          |
| ---------------- | ------------------------------------------------------------------------------------------------------ | ----------------------- |
| cli.session      | `cli.session.probed`, `cli.session.expired`                                                            | @aedev/cli-robust       |
| cli.quota        | `cli.quota.threshold`                                                                                  | @aedev/cli-robust       |
| hold.policy      | `hold.policy.created`, `.resolved`, `.escalated`, `.dropped`, `.retried`                               | @aedev/interrupt-bus    |
| approval         | `approval.request.emitted`, `approval.decision.received`, `approval.transport.failover`                | @aedev/approval-v2      |
| push.cap         | `push.cap.requested`, `push.cap.allowed`, `push.cap.denied`                                            | @aedev/push-policy      |
| move             | `move.act.started`, `move.act.completed`, `move.act.failed`, `move.step.compensated`, `move.fsm.advanced` | @aedev/moves          |
| chaos.drill      | `chaos.drill.injected`, `chaos.drill.cleaned`                                                          | @aedev/chaos            |
| agent            | `agent.lifecycle.spawned`, `.exited`, `agent.subtask.split`, `.completed`, `.failed`, `agent.fan_in.resolved` | @aedev/agent-mesh |
| roadmap          | `roadmap.scan.started`, `roadmap.proposal.emitted`                                                     | @aedev/roadmap-agent    |
| sentinel         | `sentinel.tool_call.classified`, `.hardblocked`, `.softblocked`, `sentinel.llm.reviewed`               | @aedev/sentinel         |

New kinds added by future stages must extend this table in the same PR
that adds them.

## What this amendment does NOT change

- §1 GROUND RULES — untouched (§7.3).
- §4.4 KIND_PATTERN regex — already 3-segment; this just aligns prose.
- The legacy 2-segment shorthand in casual prose (`hold.*`) remains
  acceptable as a *grouping* reference; only **emitted event kinds**
  must be 3-segment.

## Reviewer checklist

- [ ] Confirm KIND_PATTERN in packages/event-log/src/types.ts is unchanged
- [ ] Confirm every shipped emit in the codebase already uses 3-segment
      (sample: `grep -rE "kind: '[a-z]+\\.[a-z]+'," packages/` returns empty)
- [ ] Confirm the canonical-kinds table matches the implementation

## Sign-off

- Reviewer agent (independent session): _<signature line>_
- Operator (lanston): _<signature line>_

Upon dual sign-off, apply this amendment, bump EXECUTION_WORKBOOK to
v1.3 in §10 changelog, and move this proposal to `proposals/applied/`.

## Failure path

If reviewer rejects: revise per their notes; do not delete this file.
If operator rejects: move to `proposals/archived/` with rejection note.
