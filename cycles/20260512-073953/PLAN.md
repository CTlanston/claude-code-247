# Cycle 20260512-073953 PLAN — Track R3 (wire codex into _do_review)

## Target dim
R (Review)

## Specific gap being closed

R-dim L5 requires `orchestrator/main.py` to actually import and use
`codex_reviewer.run_codex_review`. Today the bridge module exists +
budget guard exists + Codex CLI is on PATH (R-L4 evidence), but
`main.py:_do_review` only invokes the single Claude reviewer.

Per kickoff Phase 2 Track R3: "Wire codex_reviewer.py into
`_process_one` Reviewer step; observe codex+Claude disagreement".

## Change being made

Modify `orchestrator/main.py:_do_review` so that AFTER the Claude
Reviewer returns a verdict, the orchestrator:

1. Calls `codex_reviewer.run_codex_review(commit_sha=<HEAD of branch>,
   cycle_id=<issue_id-based>)` via the budget guard.
2. Logs the structured CodexReview result.
3. If Codex was available + ran (verdict not "skipped"/"error"),
   compares verdicts via `disagreement_protocol(claude, codex)`.
4. On disagreement: write `ALERT.md` (do NOT auto-resolve; per L7 §7).
   The current Claude verdict is what proceeds (no auto-flip), but
   the human is notified.
5. On agreement (or codex unavailable/skipped/error): proceed as
   before; the Claude verdict is the authoritative decision.

This is **non-breaking** — Claude's verdict remains decisive. Codex
is an observer that escalates on cross-model disagreement.

Implementation notes:
- The codex review call is wrapped in `try/except` so a codex bug
  cannot crash the reviewer flow. Worst case: log + continue.
- The cycle_id passed to run_codex_review uses the task's branch
  name (e.g. `shadow/issue-N`) for diagnostics; the raw codex output
  goes to `cycles/<cycle_id>/codex-raw.log` if cycle_id is set.
- The structured CodexReview goes into a new `reports/codex-reviews.jsonl`
  for trend tracking (analogous to codex-spend.jsonl but per-review
  with the verdict + findings).

## Acceptance criteria
- [ ] `orchestrator/main.py:_do_review` calls `codex_reviewer.run_codex_review`
- [ ] On Claude↔Codex disagreement, an entry is appended to
      `ALERT.md` at repo root
- [ ] `tests/test_main_codex_integration.py` (new) covers:
      - codex agreement → no ALERT
      - codex disagreement → ALERT.md written
      - codex unavailable → no crash, no ALERT
      - codex skipped (budget) → no ALERT, normal flow
      - codex error → logged, no ALERT, normal flow
- [ ] `pytest -q` full suite green
- [ ] `scripts/compute_level.py --check` exits 0; R-dim shows L5
      ("wired into orchestrator/main.py")
- [ ] CHANGELOG, STATE, BACKLOG, LEVEL all updated

## Files to touch (closed set)
- `orchestrator/main.py` (small edit — import + insert codex call after
  Claude verdict)
- `tests/test_main_codex_integration.py` (new — mocks runner + codex)
- `cycles/20260512-073953/*`
- `BACKLOG.md`, `STATE.md`, `CHANGELOG.md`, `LEVEL.md`
- (optional) `reports/codex-reviews.jsonl` (created on first real run)

## Files forbidden to touch
- secrets, LEVEL.md by hand
- Other production code modules
- Existing tests / ADRs / FAILURES.md

## Rollback plan
`git reset --hard autoevo/pre-20260512-073953`

## Risk score
medium — touches `orchestrator/main.py` (production code in the
core reviewer flow). Mitigated by:
1. The codex call is OPTIONAL (only fires if codex is available)
2. Wrapped in try/except so failures are logged, not propagated
3. Claude's verdict remains decisive — codex disagreement only ALERTs
4. Tests stub the codex interaction so we don't burn tokens in CI

## FAILURES.md pre-flight result

Preflight flagged FAIL-0001 (V3 #14 Reviewer over-strict TDD) via
"reviewer" keyword overlap. Citation: this cycle ADDS a cross-model
reviewer (codex) ALONGSIDE the existing Claude reviewer; it does NOT
modify the V4 TDD-intent gate that fixed FAIL-0001. The Claude
reviewer's verdict remains decisive. Codex is an observer that
escalates on disagreement. **Not a repeat** — different layer (adding
parallel review path vs. softening the strict gate).

## Open questions / blockers
None.
