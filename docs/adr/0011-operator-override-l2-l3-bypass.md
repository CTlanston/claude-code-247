# ADR-0011: Operator Override of L2/L3 Gates Across the v2.1/v2.2 Build-Out

**Status:** Accepted
**Date:** 2026-05-27
**Authority:** Operator (lanston) — typed in-session: "continue run all the steps", followed by explicit authorizations on 2026-05-27 to compress wall-clock to 1 day, approve F3, share secrets via `~/.claude-code-247/with-secrets`, and self-plan remaining work.
**Builds on:** [ADR-0009](0009-aedev-as-primary-control-plane.md), [ADR-0010](0010-three-plane-event-sourced.md)
**Recorded in:** [EXECUTION_WORKBOOK.md §9 s_0002](../../EXECUTION_WORKBOOK.md)

---

## Context

The execution workbook §5 specifies a strict three-level acceptance contract per stage:

- **L1 (acceptance)** — Claude self-audit; runs the per-stage acceptance suite.
- **L2 (review)** — an *independent* Claude session reads source + event log, re-runs acceptance, samples events, writes `docs/reviews/stage-<id>-<date>.md`.
- **L3 (validate)** — the operator (human) signs off; some L3 steps require wall-clock observation windows (Stages F2 = 7 days, K/K2 = 72 hours).

§5 also says explicitly: "操作员只能在 §8 escalation 流程下显式覆盖（覆盖会写入事件日志 + §9 + ADR）." Without an ADR, an override is a contract violation.

In session s_0002 (2026-05-27), the operator instructed the agent to:

1. "Run next" — continue past Stage A's normal L2/L3 cadence and into B.
2. "Continue run all the steps in EXECUTION_WORKBOOK" — sweep through all 20 stages and place release candidates.
3. (Follow-up, after the agent surfaced what was still missing) authorize a more aggressive close-out: compress all wall-clock windows to **one day**, approve Stage F3 execution, route secrets through the existing `secrets-mcp` mechanism, allow Docker daemon start, and let the agent plan and execute the remaining self-resolvable depth work.

The first two of these were already partially papered (s_0002 §9 entry called them out). This ADR closes the gap: it is the missing §10 / ADR record that §5 mandates.

## Decision

The operator override is **accepted on the record** with the following bounds, applicable to v2.1.0 and v2.2.0 *release candidate* tags only:

### Bound 1 — `-rc<N>` only, never GA

The override authorizes `v2.1.0-rc1+` and `v2.2.0-rc1+` tags placed by an agent session. It does **not** authorize the `v2.1.0` or `v2.2.0` GA tags. GA still requires:

- A true 72h soak per workbook §3 Stage K / K2, *OR* an explicit second ADR amending the SLA (§7.3 forbids §1 GROUND RULE changes, but §3 stage criteria can be amended via §7.4 with reviewer + operator dual sign-off).
- A signed `evidence/stage-<id>/L3-validate/operator-signoff.md` for every stage exited.

### Bound 2 — Compressed wall-clock is documented, not relabeled

Where the workbook calls for a multi-hour or multi-day observation (Stage F2 7-day dual-site, Stage K 72h soak, Stage K2 72h soak, Stage H Linux 24h soak), this session ships a **synthetic equivalent compressed to a 1-day window** as the operator directed. Every such evidence file makes that compression explicit. The release-candidate label reflects this. **A real-clock run remains a precondition for the GA tag.**

### Bound 3 — Irreversible operations are individually approved

Stage F3 (`git rm -r orchestrator/ gateway/ runner/ validator/ dashboard/ memory/ pyproject.toml tests/` of the Python tree) is the only GROUND RULE 7-class operation in scope. The operator's explicit 2026-05-27 statement "F3批准了" is the §5 L3 sign-off for this single op. Future irreversibles (e.g., a hypothetical `npm publish` or a `git push --force`) are **not** covered and need their own ADR or HOLD resolution.

### Bound 4 — L2 reviewer must still run for every stage

The override does *not* skip L2; it allows L2 to be performed by an Agent-tool-launched independent reviewer subagent within the same parent session, instead of requiring a literally separate `aedev` CLI invocation. Each reviewer agent writes its own `docs/reviews/stage-<X>-<date>.md` per §5 L2.

### Bound 5 — Secrets handling stays inside `with-secrets`

The operator pointed at `~/.claude-code-247/with-secrets` and the secrets-mcp server. The agent does not read raw key values into chat or commits. All API-key-dependent invocations route through the wrapper, which redacts return output. This satisfies GROUND RULE 5's "no secret in plaintext" spirit while letting Stage M4 use the real Anthropic CLI subscription path.

## Consequences

**Positive**

- Closes the §5 paper-trail gap. Future readers see the override decision with bounds, not a silent skip.
- Lets the agent finish the remaining "self-resolvable" depth work (M3 auto-Repair, M4 LLM sentinel, F2 Fastify runtime, F1 shadow loop, etc.) without each item needing its own micro-ADR.
- Makes the rc1/rc2 → GA gap explicit. The operator can see precisely what's still required for GA.

**Negative**

- L2 reviewer passes done by Agent subprocess are weaker than "literally separate Claude CLI session" reviewer passes. Mitigation: each reviewer agent is prompted to NOT read evidence/L1-acceptance/, and gets a self-contained brief.
- 1-day compressed soak doesn't catch slow-leak or thermal classes of failures that emerge over 72h. Mitigation: the GA tag is gated on a real-clock soak the operator schedules later.
- This ADR retroactively papers s_0002's earlier `-rc1` tag placements. Going forward, ADR ↔ override pairs are written *before* the override is acted on.

## How we'll know this was right

- All `v2.x.0-rc<N>` tags carry pointers to this ADR in their tag annotation.
- The eventual `v2.1.0` and `v2.2.0` GA tags carry their own ADR-0012+ record of the operator's real-clock sign-off, with this ADR superseded by that one.
- A reviewer reading EXECUTION_WORKBOOK.md §9 s_0002 and ADR-0011 together can reconstruct what was bypassed, why, and what's still required — without consulting the operator.

If any of those break (e.g., a GA tag goes up without an ADR-0012), this ADR was insufficient and a re-write under §7.4 is required.

## Open items this ADR explicitly does NOT close

- The `@aedev/event-log` vs workbook-prescribed `@claude247/event-log` namespace inconsistency (flagged by Stage A L2 reviewer). To be resolved by either a package rename PR or a workbook amendment under §7.4.
- The pre-existing full-suite test flake (three subprocess tests timing out under heavy parallel load). To be fixed by raising `testTimeout` for those specific files in a dedicated commit, separate from this marathon.
- Workbook §3 Stage C wording uses 2-segment hold event names (`hold.created`); this session normalized to 3-segment (`hold.policy.created`) to satisfy §4.4. A workbook amendment proposal under §7.4 should formalize this.
