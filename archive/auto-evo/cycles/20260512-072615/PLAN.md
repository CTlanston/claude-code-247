# Cycle 20260512-072615 PLAN — Phase 1 (Codex cost calibration)

## Target dimension
R (Review)

## Specific gap being closed

Operator installed and OAuth-authenticated Codex CLI (binary at
`/Users/lanston/Library/pnpm/nodejs/20.20.2/bin/codex`, v0.130.0).
Per the kickoff doc, the prior "skip Codex" stance is REVOKED.

But: a sanity call burned **23,253 tokens** for "say hello". Codex
auto-loads repo context every call. The per-call cost is large and
unbounded without infrastructure.

This cycle builds the **cost-aware infrastructure** so Codex use can
proceed safely:

1. `scripts/codex_budget_guard.sh` — wraps every codex call, refuses
   if daily/per-call cap exceeded, logs spend to
   `reports/codex-spend.jsonl`
2. `HUMAN_CONFIG.md` codex fields (daily cap, per-call cap, fallback)
3. `orchestrator/codex_reviewer.py` rewrite to use guard + structured
   `{verdict, findings, tokens, duration_s}` output + graceful skip
   on budget refusal
4. ONE live calibration call to measure real per-review token cost
5. `reports/codex-cost-calibration.md` GO/NO-GO verdict
6. `docs/adr/0008-codex-cli-budgeted-review.md`
7. `scripts/compute_level.py` updated to distinguish R-L4 (CLI on
   PATH + infra) from R-L5 (review actually invoked + spend entry)

**Decision gate**: if per-review cost > $0.50 OR 10/day > $5 → write
BLOCKED.md, exit. No Phase 2.

## Change being made

Detail per kickoff §1.1–§1.6.

## Acceptance criteria (kickoff §1.6 verbatim)
- [ ] `scripts/codex_budget_guard.sh` exists + executable + tested
- [ ] `tests/test_codex_budget_guard.py` green (≥4 tests)
- [ ] `HUMAN_CONFIG.md` has new codex fields
- [ ] `orchestrator/codex_reviewer.py` updated to use guard + structured output
- [ ] `tests/test_codex_reviewer.py` green
- [ ] One real codex review call logged in `reports/codex-spend.jsonl`
- [ ] `reports/codex-cost-calibration.md` with GO/NO-GO verdict
- [ ] `docs/adr/0008-codex-cli-budgeted-review.md` written
- [ ] `compute_level.py` rerun; R at L4 (CLI on PATH) at minimum
- [ ] CHANGELOG, STATE, BACKLOG, LEVEL all updated per §4 step 9

## Files to touch (closed set)
- `scripts/codex_budget_guard.sh` (new)
- `tests/test_codex_budget_guard.py` (new)
- `HUMAN_CONFIG.md` (add codex section)
- `orchestrator/codex_reviewer.py` (rewrite — superseding cycle-7 stub)
- `tests/test_codex_reviewer.py` (extend)
- `scripts/compute_level.py` (refine R-dim L4/L5 distinction)
- `tests/test_compute_level.py` (regression for the refinement)
- `reports/codex-spend.jsonl` (new, written by guard)
- `reports/codex-cost-calibration.md` (new)
- `docs/adr/0008-codex-cli-budgeted-review.md` (new)
- `BACKLOG.md`, `STATE.md`, `CHANGELOG.md`, `LEVEL.md`
- `cycles/20260512-072615/*`

## Files forbidden to touch
- `.env*`, `secrets/**`, `*.key`, `*.pem`, `id_rsa*`
- `LEVEL.md` by hand
- `orchestrator/main.py` (Track R3 wiring is NEXT cycle, not this one)
- Other production modules
- Existing ADRs/FAILURES entries

## Rollback plan
`git reset --hard autoevo/pre-20260512-072615`

## Risk score
**medium-to-high** — actually spends real OpenAI tokens. Mitigated by:
1. Hard cap $10/month on OpenAI dashboard (operator-set)
2. Budget guard refuses past daily cap
3. ONLY ONE real call in this cycle (the calibration)
4. If first call exceeds $0.50, BLOCKED.md → exit

## FAILURES.md pre-flight result

Will run after writing this section. Expected: FAIL-0003 (Guardian
subscription) overlap on "subscription"; FAIL-0011 (mutmut tooling
blocker) overlap on "tooling" / "budget"; possibly others.

## Open questions / blockers
None. All dependencies satisfied per kickoff doc.
