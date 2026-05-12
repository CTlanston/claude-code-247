# BACKLOG.md

> Ordered list of next L7 tracks. Each cycle picks the highest-priority
> *capable* item (prerequisites met). Mark complete with DONE in <CYCLE_ID>;
> mark dropped with strikethrough + reason. Never silently delete.
>
> See §6 of `AUTODEV_L7_MASTER_PROMPT.md` for the canonical track roadmap
> and §4 Step 4 for the picker logic.

## P0 — immediate next cycle

- [ ] [Track E2] Implement `scripts/propose_next_track.py` (priority: P0)
      details: E-dim L4 requires this script. Reads FAILURES.md + LEVEL.md
      + BACKLOG.md and proposes the next track with citations. Lift E from
      L3 to L4 in one cycle (cheapest floor-dim move available — R needs
      Codex bridge for L5; C needs worktrees; T needs 3 property modules).
      prerequisites: FAILURES.md / LEVEL.md / BACKLOG.md present (all DONE)
      rubric dim: E (Self-improvement) — moves L3 → L4

- [ ] [Track T2-property-billable] Add Hypothesis property tests for
      orchestrator.billable.to_billable_cost (priority: P0)
      details: Property-based test file `tests/test_billable_properties.py`
      with >= 3 properties:
        * `is_subscription_mode` is a pure function of env (idempotent)
        * `to_billable_cost(...)` always returns >= 0
        * subscription mode forces 0 regardless of raw input
      Counts toward Track T2 (property-based on >=3 modules → L4); this
      cycle adds one of three module's worth.
      prerequisites: pytest can find hypothesis (likely already)
      rubric dim: T (Test oracle) — partial step toward L4

## P1 — next 3 cycles

- [ ] [Track S2] Promote preflight from V4-implemented to L7-first-class-gate
      with regression-test gate matrix (priority: P1)
      details: V4 added preflight, but it's only wired into `_do_planning`.
      Make it a first-class gate alongside Guardian + TDD invariant: callable
      from any orchestrator entry point, returns structured result, has its
      own metrics counter, has a "preflight bypassed" audit event when a
      caller explicitly skips it. Document via ADR.
      prerequisites: M1 DONE. Existing preflight tests (5) pass.
      rubric dim: S (Safety gates) — preflight already counted but not
      first-class

- [ ] [Track R2] Wire local Codex CLI as cross-model second-opinion Reviewer
      (priority: P1)
      details: Add `orchestrator/codex_reviewer.py` that shells out to the
      user's local Codex CLI on the same PR diff Claude Reviewer saw, gets
      verdict, compares. Disagreement → write `ALERT.md`, do NOT auto-resolve.
      Strictly LOCAL Codex auth — no Codex API key.
      prerequisites: user's `codex` CLI on PATH with subscription auth
      rubric dim: R (Review) — moves L3 → L5 when working

- [ ] [Track T2] Property-based tests (Hypothesis) on V4 modules
      (priority: P1)
      details: Add `tests/test_billable_properties.py`,
      `tests/test_preflight_properties.py`, `tests/test_tdd_intent_properties.py`.
      Hypothesis strategies for token counts, cost USD, issue body text,
      commit prefix order. Each property file >= 3 property tests.
      prerequisites: `hypothesis` package installable (likely already in deps)
      rubric dim: T (Test oracle) — moves L3 → L4

## P2 — landmark tracks (next 5-10 cycles)

- [ ] [Track E2] Implement `scripts/propose_next_track.py`
      details: Reads `FAILURES.md`, `LEVEL.md`, `BACKLOG.md` and proposes
      the next track with citations. Track outputs in
      `cycles/<id>/next-track-proposal.json`.
      rubric dim: E (Self-improvement) — moves L3 → L4

- [ ] [Track H1] `orchestrator/health.py` — health score computation
      details: Per §10 of the master prompt: 9 input signals (test pass,
      lint, recent failure rate, stuck issues, Guardian pauses, flaky tests,
      large diffs, untracked risk, cost budget) → 0-100 score.
      rubric dim: cross-cuts (S + E)

- [ ] [Track P1] Strict Planner output contract enforcement
      details: Per §7 Planner contract — JSON-or-equivalent with all required
      fields. Add validation gate that rejects Planner output missing any
      field. Regression test: valid pass, missing-criteria reject, etc.
      rubric dim: cross-cuts (M + S + R)

- [ ] [Track P4] Diagnose mode implementation (`orchestrator/diagnose.py`)
      details: Per §7 Diagnose contract + §11 state machine. Triggers on
      2× CI fail / 2× Reviewer reject / repeat error signature / no progress.
      Flow: reproduce → minimize → 3 hypotheses → fix → regression test.
      rubric dim: cross-cuts (M + S + R + T)

- [ ] [Track K1] `.claude/skills/` directory + minimal Wave 1 SKILL.md files
      details: matt.diagnose, matt.tdd, matt.to-issues,
      matt.improve-codebase-architecture, matt.grill-with-docs. Each is a
      single .md file, no external dependencies.
      rubric dim: aux (supports all tracks)

- [ ] [Track K2] SkillRouter module + tests (`orchestrator/skill_router.py`)
      details: Per §8 — classify task type + risk, select skills.
      Pseudocode in the master prompt. Regression test covers bug routing,
      feature routing, refactor routing, high-risk escalation, unknown
      fallback.
      prerequisites: K1 DONE
      rubric dim: aux

- [ ] [Track C2] Convert orchestrator to git worktrees
      details: Single-stream → 2-stream worktree-based parallelism. Per
      §6 Track C. Risky; defer until M + S + R are at L4+.
      rubric dim: C (Concurrency) — moves L3 → L4

## P3 — long horizon (after 20+ cycles)

- [ ] [Track T3] Mutation testing (mutmut) on V4 modules, ≥80% kill rate
- [ ] [Track L1] `scripts/v5_live_sanity.sh` — one-task gated live test
- [ ] [Track S3] Intake sanitizer for prompt-injection patterns
- [ ] [Track S4] Action-layer evaluator for shell/git commands
- [ ] [Track M4] Failure auto-clustering script
- [ ] [Track R4] Adversarial Reviewer subagent role
- [ ] [Track S5] Adversarial subagent return-check
- [ ] [Track S6] Canary-token leakage scan
- [ ] [Track L3] Long-running supervisor (`scripts/autodev_supervisor_local.sh`)
- [ ] [Track L4] launchd autostart install — only after 7 days of L2/L3 green

## Completed

- [x] [Track M2.5] FAILURES.md grown from 4 → 10 entries + integrity tests
      DONE in 20260512-044425 (M-dim L4 → L5)
- [x] [Track M2] scripts/preflight_failures.py + 18 regression tests
      DONE in 20260512-043811
- [x] [Track M1] Bootstrap CONTEXT.md + ADRs 0000-0004 + FAILURES.md seed
      DONE in 20260512-042701
- [x] [Track S1] Document Guardian + TDD invariant in CONTEXT.md
      DONE in 20260512-042701
- [x] [Track R1] Document single-model Reviewer in CONTEXT.md
      DONE in 20260512-042701
- [x] [Track T1] Document unit + replay test coverage (V4 30 tests)
      DONE in 20260512-042701
- [x] [Track E1] Document manual track-selection workflow (this BACKLOG)
      DONE in 20260512-042701

## Dropped

(none yet)
