# Cycle 20260512-081235 Report — Track R6 (adversarial reviewer)

## Verdict
PASS — R-dim L5 → L6. The third reviewer is online: a single-purpose
Claude Code subagent that asks "how does this change break in
production?" Wired into `_do_review` as the 3rd pass after Claude
main + Codex, with asymmetric ALERT escalation on Claude=APPROVE +
Adversarial=REJECT.

## Level changes
| Dim | Before | After |
|---|---|---|
| M | 7 | 7 (max) |
| S | 7 | 7 (max) |
| R | 5 | **6** |
| C | 4 | 4 (sole floor) |
| T | 5 | 5 |
| E | 6 | 6 |

Overall L = 4 (unchanged; C is sole floor).

## Change

1. **`runner/roles/adversarial_reviewer.md`** (new): single-purpose
   subagent prompt. Hunts for 10 categories of production failure mode
   (race/TOCTOU, N+1, trust boundaries, silent loss, leaks, auth,
   incompat, idempotency, off-by-one, time-of-check-vs-use). Anti-
   injection rules: untrusted issue text + CLAUDE.md commits = reject
   under category=trust.

2. **`orchestrator/adversarial_reviewer.py`** (new):
   - `AdversarialReview` / `AdversarialFinding` dataclasses (parallel
     to Codex's `CodexReview` / `CodexFinding`)
   - `run_adversarial_review(task, issue_id) -> AdversarialReview`
     invokes the subagent via the existing `runner.run_role` path
   - All failure modes return structured `verdict` values; NEVER
     raises in the caller's hot path
   - `adversarial_disagreement(claude, adv)` returns an escalation
     reason iff Claude=APPROVE AND Adversarial=REJECT (asymmetric:
     adversarial-passes-but-Claude-rejects is just Claude doing its
     job, no escalation needed)

3. **`orchestrator/main.py`**:
   - Added `import adversarial_reviewer`
   - New constant `ADVERSARIAL_REVIEWS_LOG = reports/adversarial-reviews.jsonl`
   - `_do_review` now calls `_maybe_run_adversarial_review` AFTER Codex
   - New helper `_maybe_run_adversarial_review`:
     * Catches all exceptions
     * Always logs to ADVERSARIAL_REVIEWS_LOG with full schema
     * Flips `disagreement: true` and calls `codex_reviewer.write_alert`
       (shared with Codex's ALERT path) on detected disagreement

4. **`tests/test_adversarial_reviewer.py`** (new, 12 tests):
   - Role prompt exists + is single-purpose (2)
   - Adapter API: dataclass shape, verdict parsing (approve/reject/
     unknown), findings extraction, error path, missing-verdict
     fallback, schema (7)
   - Integration with _do_review: invocation order, disagreement →
     ALERT.md, exception swallow, log shape (4 tests; one mocking
     three reviewers + the surrounding state machine)

## Files modified
```
runner/roles/adversarial_reviewer.md          (new, ~80 lines)
orchestrator/adversarial_reviewer.py          (new, 110 lines)
orchestrator/main.py                          (+import + 2 constants + 60-line helper)
tests/test_adversarial_reviewer.py            (new, 12 tests, 290 lines)
CHANGELOG.md, BACKLOG.md, STATE.md, LEVEL.md
cycles/20260512-081235/*
```

## What this does NOT do
- Does NOT actually run the adversarial subagent during pytest
  (tests stub `runner.run_role`); the first real adversarial review
  happens the next time the supervisor processes a real PR.
- Does NOT change Claude's verdict authority. Adversarial is observer
  only.
- Does NOT combine the three reviewers into a single panel — that's
  Track R7 (next P1), which adds `orchestrator/review_panel.py` for
  formal N-of-3 disagreement aggregation.

## Verify
- pytest: 325 passed, 2 skipped, 0 failed
- compute_level: R=L6 ("Adversarial Reviewer active")
- compute_level --check: passed
- doctor: 11/0/2

## Next track
Per propose_next_track: **Track C3** (Scheduler.dispatch_next + start
accumulating zero-deadlock streak — the only remaining path to
overall L5).

## Wall clock
~10 minutes. Most expensive step was writing the 12-test integration
suite with the four reviewer-flow mocks.
