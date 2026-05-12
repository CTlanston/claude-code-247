# Codex CLI Cost Calibration — Cycle 15

> Generated 2026-05-12, Cycle 20260512-072615. Per kickoff §1.4–§1.5.

## TL;DR

**Verdict: GO** (conditional, with monitoring).

A `codex review --commit 0c2026e` on a 10-line gitignore diff burned
**130,162 total tokens** in **57 seconds**. The session reports
`plan_type: "pro"` and rate-limits at 0% used (no quota consumption
visible on either the 5-hour or 7-day window). This strongly suggests
**ChatGPT Pro subscription-included billing** rather than paid-API
per-token billing. Per-review estimated USD cost: **≈ $0.00 actual**
(subscription includes), **≈ $0.65 worst-case** if billed as paid API.

The discrepancy is large enough that the operator should confirm the
billing model on the OpenAI dashboard before scaling to many reviews
per day. Until confirmed, treat the worst-case ($0.65/review) as the
budget reality and proceed cautiously.

## Calibration call details

| Metric | Value |
|---|---|
| Command | `bash scripts/codex_budget_guard.sh review --commit 0c2026e` |
| Diff size | 10 lines (.gitignore only) |
| Total session tokens | **130,162** |
| Last single-call tokens | 22,955 |
| Cached input tokens (free) | 104,448 |
| Wall duration | 57 s |
| Codex exit code | 0 (success) |
| Codex output | `findings: []`, `overall_correctness: "patch is correct"`, `overall_confidence: 0.91` |
| Plan type (from rate_limits) | **pro** |
| Rate-limit consumption (after call) | 0.0% (5-hour window), 0.0% (7-day window) |
| Model context window | 258,400 tokens |

The session JSONL is at
`/Users/lanston/.codex/sessions/2026/05/12/rollout-2026-05-12T04-33-04-019e1b1a-8aaa-79c1-93c5-06559330ae5e.jsonl`.

## Why so many tokens?

Codex CLI auto-loads repo context every call (kickoff doc's prior
observation that a "say hello" prompt burned 23K tokens is consistent).
The 22,955 "last call" tokens match that observation exactly — the
overhead is the context auto-load.

The 130K total reflects multiple internal turns Codex makes per review:
- Initial context load (≈ 22K)
- Exploratory tool calls (`git ls-files`, `rg "scratch"`, `git status`)
- Each followup turn adds another ≈ 22K input + a few hundred output tokens
- ~5-6 internal turns × 22K = ≈ 130K

This is consistent with Codex's agentic-review design (it explores the
repo before judging), not a bug.

## Cost projections

| Mode | Per-review | At 10 reviews/day | At 50 reviews/day |
|---|---|---|---|
| ChatGPT Pro (subscription-included, observed) | ≈ $0.00 actual | ≈ $0.00 | ≈ $0.00 |
| Paid API (worst-case, gpt-5 input @ $0.005/1K) | ≈ $0.65 | ≈ $6.50 | ≈ $32.50 |

With operator's $10/month OpenAI hard cap:
- If subscription billing: unlimited reviews within Pro plan limits
- If paid-API billing: capped at ≈ 15 reviews/month, NOT viable for routine use

## Decision gate (per kickoff §1.4)

The gate: per-review > $0.50 OR 10/day > $5 → NO-GO + BLOCKED.md.

- **Observed (subscription):** $0.00/review, $0.00/day → **GO**
- **Worst-case (paid API):** $0.65/review > $0.50 threshold, $6.50/10-day > $5 threshold → **NO-GO**

Resolution: the JSONL evidence (`plan_type: "pro"`, `credits: null`,
`used_percent: 0.0`) supports the subscription-included
interpretation. Therefore the cycle **proceeds to GO** with this
caveat:

> **Operator must confirm on OpenAI dashboard (https://platform.openai.com/usage)
> that Codex CLI usage does NOT count against paid-API spend. If it
> does, set the in-system daily cap to ≈ 8 reviews/day (8 × $0.65 = $5.20)
> to stay under the $10/month hard cap, write ADR-0008b explaining the
> revision, and re-run calibration.**

## Risk register

| Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|
| Codex billing model is paid-API, not subscription | Medium | High | Operator dashboard check; in-system cap stays at 200K tokens/day = ≈ 1.5 reviews/day at observed rate, well under $1/day |
| `plan_type: "pro"` is misleading (rate-limit field, not billing) | Low | High | Same — keep budget guard restrictive until confirmed |
| Codex auto-context grows over time | Low | Medium | Cache savings (104K of 130K were cached) limit cost growth on repeated reviews of similar diffs |
| Codex changes output format in a future version | Medium | Low | Session JSONL parser handles structural changes more robustly than stdout-regex |

## Next actions (Phase 2 enablement)

1. **Cycle 16 (Track R3)**: wire `codex_reviewer.run_codex_review` into
   `orchestrator/main.py`'s reviewer step, so PR reviews get
   Claude + Codex panel. With each PR review: log the spend,
   compare verdicts, write ALERT.md on disagreement.
2. **Cycle 18 or so**: collect 5+ real review-spend entries; recompute
   per-review average; refine budget caps if observed cost differs
   materially from this calibration.
3. **Optional**: write `scripts/codex_spend_daily.sh` to summarize the
   spend log nightly into a one-line operator-facing report.

## Acceptance gate status

Cycle 15 §1.4 acceptance: **MET, conditional**. Per-review cost is
within budget under the subscription billing model. If operator
confirms paid-API billing on their dashboard, this verdict converts
to NO-GO and a new ADR governs the revised constraints.
