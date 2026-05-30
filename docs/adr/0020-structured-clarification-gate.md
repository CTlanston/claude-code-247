# ADR-0020 — Structured Clarification Gate

# Status

Accepted — operator-directed (Stage E2E-2, 2026-05-30). Implementation tracked on
branch `claude/e2e-1`. Local/deterministic gate logic — no token spend, no
outward writes.

# Context

Today a mission goes `createMissionCandidate → requestApproval → approveMission →
run`, and the coder runs against whatever PRD the `LeadAgent` synthesized from the
raw description. There is **no AI-initiated requirement elicitation**: if the
operator's description is vague ("make the dashboard better", "fix the tests"),
the system proceeds anyway and the ambiguity surfaces late — as rework, a
wrong-scoped diff, or an `inconclusive` validator verdict. E2E-1 already showed
the cost of weak up-front signal (the coder did *a* reasonable thing, but nobody
confirmed it was *the* thing).

`lead-agent.ts` has a latent "Clarify mission intent and acceptance criteria"
task and `operator.ts` can render clarifying questions, but **nothing enforces a
gate** — clarification is advisory, not a precondition.

The E2E-2 goal (workbook §3): before the coder acts, the system should
**proactively** ask a small number of structured questions when a mission is
ambiguous, collect the answers, and emit a **verifiable** `clarified-spec.md`
that becomes coder input. Crucially it must **not over-gate** clear missions.

# Decision

Insert a `ClarificationGate` between intake and the role pipeline — concretely,
inside `IntakeService.createMissionCandidate`, after the `MissionDesign` is
synthesized and before `requestApproval`.

## D1 — Ambiguity scoring (deterministic, no LLM)

`scoreAmbiguity(mission, design, policy) → { score: 0..100, reasons[], missing[] }`
from cheap, explainable signals:
- **No verifiable acceptance criteria** — `design.prd.acceptanceCriteria` is
  empty, or every entry is a placeholder ("TBD", "verify it works", < N chars,
  no observable verb). Strongest signal.
- **Vague description** — very short, or matches vague-intent patterns
  ("improve", "better", "polish", "some", "etc", "and so on", "make it nice")
  without any concrete noun/metric/file.
- **No target surface** — no file/path/component/command named, for a non-trivial
  ask.
- **Unbounded scope** — "everything", "all the", "refactor the whole".

Each signal contributes a weight (in `policies.yaml`); the total is clamped to
100. The gate triggers when `score >= clarification.trigger_threshold`. Clear
missions (concrete acceptance criteria + a named surface) score low and pass
straight through — the no-over-gate requirement is a first-class test.

## D2 — Structured questions (≤ N, option-style)

When triggered, `generateQuestions(...)` returns **at most
`clarification.max_questions` (default 4)** structured questions, each with: an
`id`, the `field` it resolves (acceptance-criteria / scope / target / done-
definition), option-style `choices` (operator may pick or free-type), and a
`recommendedDefault`. Questions are generated from the *missing* signals (only ask
what's actually unclear), mirroring the `AskUserQuestion` shape. No infinite
loops: one round, ≤ N questions.

## D3 — Lifecycle + events (event → view, GR#6)

State on the mission: `clarification_status ∈ {not_required, requested,
answered, resolved}`. Three events, emitted in order:
- `mission.clarification.requested` — gate triggered; payload has the questions.
- `mission.clarification.answered` — operator answers recorded.
- `mission.clarification.resolved` — answers folded into a verifiable
  `clarified-spec.md` (written next to the PRD) with concrete acceptance points;
  mission may now proceed to `requestApproval`.

`clarified-spec.md` is added to the coder's evidence/input bundle. A mission that
scores below threshold goes straight to `not_required` (no events, no friction).

## D4 — Policy (config/policies.yaml)

```yaml
clarification:
  enabled: true
  trigger_threshold: 50        # ambiguity score >= this triggers the gate
  max_questions: 4             # never ask more than this in one round
  min_acceptance_criteria: 1   # fewer real criteria than this is a signal
  signals:                     # weights, clamped to 100
    no_acceptance_criteria: 60
    vague_description: 25
    no_target_surface: 20
    unbounded_scope: 25
```

# Consequences

**Positive.** Ambiguous missions converge to a verifiable spec before any token
is spent on the coder; fewer `inconclusive` verdicts and less rework; the
operator answers a few sharp questions instead of reviewing a wrong PR.

**Guardrails.** ≤ N questions, single round — never an interrogation. Only
above-threshold missions are gated; clear ones pass untouched (covered by a
false-gate-rate test). The scorer is deterministic/explainable (every trigger
lists its `reasons`), so behavior is auditable and testable without an LLM.

**Risks.** A bad threshold could over- or under-gate; mitigated by it being a
single tunable in `policies.yaml` + recall/precision tests over labeled
ambiguous/clear fixtures. The question generator is template-based for now (no
LLM call), consistent with the deterministic-gate principle; a future ADR may add
an optional LLM-authored question pass behind the same interface.

# Alternatives considered

- **LLM-scored ambiguity** — rejected for v1: adds token cost + nondeterminism to
  a gate that must be fast and testable. The interface (`scoreAmbiguity`) leaves
  room to swap in an LLM later.
- **Gate after approval** — rejected: clarification must precede human approval so
  the operator approves a *clarified* mission, not a vague one.
- **Make the existing lead-agent clarify task mandatory** — that task is advisory
  prose; a dedicated gate with explicit state + events is testable and enforceable.

# Date

2026-05-30
