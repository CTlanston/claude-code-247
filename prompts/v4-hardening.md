# V4 Hardening Mission: Make auto-evo 24/7 Ready

You are continuing the existing `auto-evo` / `auto-evo-playground` project.

Your task is to fix the remaining V3 critical failures and push the system toward reliable 24/7 autonomous operation.

Do not only analyze. You must inspect the repo, modify code, add regression tests, run validation, and write a final report.

## 0. Current Situation

V3 result: VERDICT FAIL (critical_fail=3, pass=5).
Remaining critical failures:
- C1: only 1/3 PRs opened
- C6: Guardian false-pauses because it reads raw DB cost
- C12: only 1/3 issues reached terminal state

Stuck issues:
- #14 chunks: Reviewer rejected twice; TDD-ordering rule is too strict
- #15 reverse edges: reverse() does not exist in src/utils.py and modifying it is forbidden → impossible spec; not caught before Coder ran

Latent issue:
- Guardian reads runs.cost_usd directly; the metrics.json subscription mask
  is bypassed so estimated Sonnet/Opus token cost causes false pauses.

## 1. Hard Constraints

- No git push, no merge, no .env edits, no paid API.
- Every behavior change has a regression test.
- If blocked: write reports/v4-blockers.md and continue.
- Don't claim success without test evidence.
- Don't weaken safety controls globally.

## 2. Tracks

### Track 1 — Guardian subscription cost false-pause
Make Guardian budget logic use BILLABLE cost (0 under subscription mode),
not raw estimated cost. Add a shared helper. Tests:
- subscription + high raw → no pause
- non-subscription + high cost → pause
- metrics.json and Guardian logic agree

### Track 2 — Issue preflight for impossible specs
Detect issues like #15 BEFORE Coder runs. Mark them terminal
(`failed` or equivalent). Detection rule:
- references symbol X
- X absent from required file
- modifying the required file is forbidden
→ blocked_impossible_spec

Tests:
- reverse() absent + src/utils.py forbidden → terminal
- reverse() present → ok
- function absent but file mod allowed → ok
- unrelated issue → ok

### Track 3 — Reviewer TDD-intent policy
Replace strict per-step TDD ordering with intent detection:
- meaningful tests present AND at least one test commit precedes at least one feat commit → PASS
- no tests → FAIL
- all tests after all impl → WARN/FAIL

### Track 4 — Pending-work detection hardening
Helper must set STATE_DIR explicitly, never silently return False, log
diagnostic on path-resolution failure. Test with custom temp STATE_DIR.

### Track 5 — V4 validation
pytest -q; run focused tests for each track; shortest deterministic e2e
harness that proves the same behaviors.

## 3. Final Report
Write reports/e2e-verdict-v4.md (PASS or FAIL with per-criterion evidence).

## 4. Execution Priority
1 → 2 → 3 → 4 → 5 → final report.

## 5. Autonomy Rules
Don't ask for clarification unless secret/credential/external service needed.
If one track blocked: continue others. Fix tests, don't bypass them.
Don't manually clear Guardian pause as the solution — fix root cause.
