# Cycle 20260512-072615 Report — Phase 1 Codex Cost Calibration

## Verdict
PASS — R-dim L3 → L4. Codex cross-model bridge infrastructure is
ready + one real review call calibrated cost + ADR-0008 documents the
carve-out. Phase 2 (Track R3, wiring into main.py) is unblocked.

## Level changes
| Dim | Before | After | Note |
|---|---|---|---|
| M | 7 | 7 | unchanged (max) |
| S | 7 | 7 | unchanged (max) |
| R | 3 | **4** | bridge infra ready: code + tests + guard + CLI on PATH |
| C | 3 | 3 | unchanged (now SOLE floor) |
| T | 4 | 4 | unchanged (FAIL-0011 mutmut blocker) |
| E | 6 | 6 | unchanged |

Overall L = 3 (C is the only floor now).

## Change

Per kickoff Phase 1 verbatim:

1. **`scripts/codex_budget_guard.sh`** (new): wraps every codex
   invocation with daily/per-call cap enforcement + append-only spend
   log. Defensive parsing: prefers `~/.codex/sessions/*/rollout-*.jsonl`
   for accurate token count, falls back to stdout regex for test stubs.

2. **`tests/test_codex_budget_guard.py`** (new, 11 tests): normal
   call recording, daily-cap refusal, yesterday-tokens ignored, per-call
   anomaly flag, comma-handling, unparseable fallback, concurrent
   calls.

3. **`HUMAN_CONFIG.md`**: added `runtime.codex_enabled/codex_daily_cap_tokens/
   codex_per_call_cap_tokens/codex_fallback_on_refusal/codex_binary` fields.

4. **`orchestrator/codex_reviewer.py`**: rewrote to use guard wrapper
   + structured `CodexReview` output schema per kickoff §1.3
   (source, model, verdict, findings, tokens, duration_s, reason).
   Backward-compat alias `CodexVerdict = CodexReview` kept.

5. **`tests/test_codex_reviewer.py`** (rewritten, 19 tests):
   availability check (PATH + guard), unavailable → skipped, budget
   refusal → skipped, verdict parsing (approve/reject/unknown),
   non-zero exit → error, findings extraction with categories,
   raw-log persistence per cycle_id, timeout handling, schema check.

6. **`scripts/compute_level.py`**: R-dim rubric refined:
   - L3: single Reviewer baseline
   - **L4: codex bridge infra ready** (module + tests + CLI on PATH
     + guard script executable) — NEW THIS CYCLE
   - **L5: orchestrator/main.py imports codex_reviewer** — gates the
     production-wired claim (NEW THIS CYCLE; Track R3 will exercise)
   - L6/L7 unchanged

7. **`tests/test_compute_level.py`**: +3 R-dim tests (L4 infra,
   L5 wired, L4-but-dormant L5-blocker). Total 33 tests, all green.

8. **Live calibration call**: `codex review --commit 0c2026e` on a
   10-line gitignore diff. Tokens: **130,162** (total session;
   includes 104,448 cached input). Wall duration 57s. Exit 0. Codex
   output: `findings: []`, `overall_correctness: "patch is correct"`,
   `overall_confidence: 0.91`. Session metadata: `plan_type: "pro"`,
   rate-limits 0% used — **subscription-included billing observed**.

9. **`reports/codex-cost-calibration.md`** (new): GO verdict
   (conditional). Per-review cost ≈ $0 under observed plan, $0.65
   worst-case if paid-API billing. Operator should confirm on
   OpenAI dashboard.

10. **`docs/adr/0008-codex-cli-budgeted-review.md`** (new): documents
    the carve-out from §0.5 (no paid third-party); ties to ADR
    precedent for future ADR-0008b if billing model is revised.

## Files modified

```
scripts/codex_budget_guard.sh         (new, executable, +175 lines)
tests/test_codex_budget_guard.py      (new, +200 lines, 11 tests)
HUMAN_CONFIG.md                       (+6 lines: codex section)
orchestrator/codex_reviewer.py        (rewritten, 296 lines, +120 net)
tests/test_codex_reviewer.py          (rewritten, 240 lines, 19 tests)
scripts/compute_level.py              (R-dim L4/L5 refinement, +35 lines)
tests/test_compute_level.py           (+3 R-dim tests; 33 total)
reports/codex-spend.jsonl             (new, 1 calibration entry)
reports/codex-cost-calibration.md     (new, GO verdict)
docs/adr/0008-codex-cli-budgeted-review.md (new)
CHANGELOG.md, BACKLOG.md, STATE.md, LEVEL.md
cycles/20260512-072615/*
```

## Acceptance criteria (kickoff §1.6 verbatim)
- [x] `scripts/codex_budget_guard.sh` exists + executable + tested
- [x] `tests/test_codex_budget_guard.py` green (11 tests, target ≥ 4)
- [x] `HUMAN_CONFIG.md` has new codex fields
- [x] `orchestrator/codex_reviewer.py` updated to use guard + structured output
- [x] `tests/test_codex_reviewer.py` green (19 tests)
- [x] One real codex review call logged in `reports/codex-spend.jsonl`
- [x] `reports/codex-cost-calibration.md` written with verdict GO
- [x] `docs/adr/0008-codex-cli-budgeted-review.md` written
- [x] `compute_level.py` rerun; R at L4
- [x] CHANGELOG, STATE, BACKLOG, LEVEL all updated

## Verify
- pytest: 258 passed, 1 skipped, 0 failed
- compute_level: R=L4, all others stable
- compute_level --check: passed
- doctor: 11/0/2
- codex live call: 1 entry, 130,162 tokens, plan=pro, verdict=approve

## Decision gate result

Per kickoff §1.4: cost ≤ $0.50/review AND 10/day ≤ $5? Under observed
subscription billing: YES, both clear ($0/review). Under paid-API
worst-case: NO ($0.65/review). The session evidence (plan_type=pro,
rate_limits=0%, credits=null) strongly favors subscription. GO
verdict issued.

Operator action: confirm OpenAI dashboard reflects subscription, not
paid-API consumption. If paid, file ADR-0008b and tighten the cap.

## Next track
Per propose_next_track + kickoff Phase 2: **Track R3** (wire
codex_reviewer into orchestrator/main.py reviewer step). Lifts R 4→5.

## Wall clock
~35 minutes (under 45-min cap). Most expensive step was the live
codex review call (57s of that wall clock was the codex turn).
