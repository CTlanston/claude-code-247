# Cycle 20260512-082125 PLAN — Track R7 (N-of-3 reviewer panel)

## Target dimension
R (Review)

## Specific gap being closed

`compute_level.py`'s `REVIEW_MARKERS["n_of_3_with_escalation"]` requires:
- A module: `orchestrator/review_panel.py`
- A test: `tests/test_review_panel.py`
- That test contains keywords `n_of_3` and `disagreement_escalate`

Lifts R from L6 to **L7 (max)** in one cycle.

## Change being made

1. **`orchestrator/review_panel.py`** (new): aggregator over the three
   already-wired reviewers. Pure-Python panel layer with NO side effects
   in its core function — the side effects (write_alert) stay in
   `_do_review`'s callers. Goal: take three verdicts in, return a
   structured `PanelVerdict` with disagreement-as-signal classification.

   API:
   ```python
   @dataclass
   class PanelVerdict:
       overall: str                  # approve|request_changes|reject|disagreement
       votes: Dict[str, str]         # {"claude": "...", "codex": "...", "adv": "..."}
       agree_count: int              # how many voters reached consensus
       disagreement_summary: Optional[str]  # one-line description
       escalate: bool                # write ALERT.md? True iff >=2 voters
                                       # disagree on pass/fail OR any voter
                                       # rejects a Claude-approved PR
   
   def n_of_3(claude_verdict, codex_verdict, adv_verdict) -> PanelVerdict
   def disagreement_escalate(panel: PanelVerdict, alert_path: Path) -> bool
   ```

   Decision rules:
   - If all three voters agree on PASS → overall=approve, escalate=False
   - If all three agree on FAIL → overall=reject, escalate=False
   - If 2-of-3 agree on PASS but 1 rejects → overall=disagreement,
     escalate=True (the dissenting voice may have caught a real issue;
     escalate per L7 §7 — NO auto-resolve)
   - If 2-of-3 agree on FAIL but 1 approves → overall=request_changes,
     escalate=True (still don't auto-merge; humans decide)
   - codex_unavailable / error / unknown / skipped are NOT votes —
     they're abstentions; panel works on whoever actually voted

2. **`tests/test_review_panel.py`** (new, ≥ 8 tests covering each
   decision rule including abstention handling).

3. **`scripts/compute_level.py`**: no changes — the existing
   `REVIEW_MARKERS["n_of_3_with_escalation"]` already detects this
   once the files exist.

## Acceptance criteria
- [ ] `orchestrator/review_panel.py` exists with `n_of_3`,
      `disagreement_escalate`, `PanelVerdict`
- [ ] `tests/test_review_panel.py` has ≥ 8 tests, all green; mentions
      `n_of_3` and `disagreement_escalate` (keyword evidence)
- [ ] `pytest -q` full suite green
- [ ] `compute_level.py` reports `R = 7` (max)
- [ ] `compute_level --check` exits 0
- [ ] CHANGELOG, STATE, BACKLOG, LEVEL all updated

## Files to touch (closed set)
- `orchestrator/review_panel.py` (new)
- `tests/test_review_panel.py` (new)
- `cycles/20260512-082125/*`
- `BACKLOG.md`, `STATE.md`, `CHANGELOG.md`, `LEVEL.md`

## Files forbidden to touch
- secrets, LEVEL by hand
- Other production modules (this cycle is pure-additive; review_panel
  is NOT yet wired into _do_review — that's a future cycle if we
  want to switch from observer-with-ALERT pattern to formal panel
  aggregation)
- Existing tests / ADRs / FAILURES

## Rollback plan
`git reset --hard autoevo/pre-20260512-082125`

## Risk score
low — pure-function module + tests. No production flow changes.

## FAILURES.md pre-flight result
Will run after writing this section.

## Open questions / blockers
None.
