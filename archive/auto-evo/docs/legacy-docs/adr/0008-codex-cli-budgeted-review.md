# ADR-0008: Codex CLI permitted for cross-model review, gated by budget guard

## Context

The L7 §0.1 hard constraint forbids paid Anthropic API calls. The
§0.5 constraint forbids paid third-party services more broadly.

Codex CLI (OpenAI) was previously deferred under that interpretation.
On 2026-05-12 the operator:
1. Installed Codex CLI v0.130.0 at
   `/Users/lanston/Library/pnpm/nodejs/20.20.2/bin/codex`
2. OAuth-authenticated it via `codex login` (browser flow)
3. Set a $10/month hard cap on the OpenAI usage dashboard as a safety
   net
4. Explicitly authorized its use for Track R cross-model review

Cycle 15 calibration (this cycle) ran one `codex review` on a 10-line
diff. Result: 130,162 total session tokens, 57s wall duration. Session
metadata showed `plan_type: "pro"`, `credits: null`, rate-limits at
0% used. This is consistent with **ChatGPT Pro subscription-included
billing** — the user's existing Pro subscription appears to cover
Codex usage at no additional per-token charge.

The kickoff doc and §0.5 carve-out explicitly permits this carve-out
provided it goes through a budget guard.

## Decision

Codex CLI calls are permitted from `orchestrator/codex_reviewer.py`
ONLY when:

1. The call goes through `scripts/codex_budget_guard.sh`
2. The daily-cap check passes (`AUTODEV_CODEX_DAILY_CAP`, default
   200,000 tokens/day ≈ 1.5 reviews at calibration rate)
3. The per-call anomaly threshold (`AUTODEV_CODEX_CALL_CAP`, default
   60,000) is logged as `anomaly: per_call_cap_exceeded` if exceeded
   (does not block — already complete)
4. The spend log at `reports/codex-spend.jsonl` is honored as the
   source of truth for daily totals

Single-Claude review remains the fallback for all cases where:
- The budget guard refuses (exit 2)
- Codex returns an error
- Codex is missing from PATH
- The session JSONL is unparseable

The cycle is NEVER blocked by codex unavailability — codex is
enhancement, not dependency.

## Consequences

Good:
- R-dim can advance from L3 (no bridge) to L4 (infra ready, this
  cycle) and L5 (production-wired, next cycle).
- Each cycle has a measurable codex cost trail in
  `reports/codex-spend.jsonl` with daily totals, per-call tokens,
  cached input savings, and the OpenAI plan type.
- Discipline is enforced by software, not by self-control.
- Documented carve-out from the original §0.1 zero-paid-API stance,
  scoped narrowly to Codex CLI via OAuth-authenticated subscription.

Bad:
- Adds OpenAI as an external dependency. If OpenAI rate-limits or
  the CLI breaks, cycles continue but R-dim usage drops back to
  single-Claude.
- Token cost is real and visible to the operator monthly via the
  OpenAI dashboard. The operator has the final word; if the dashboard
  shows paid-API consumption rather than subscription-included
  consumption, this ADR is amended and the daily cap tightens.
- The 130K-tokens-per-review rate is large enough that without the
  budget guard, a runaway loop could burn through a $10 monthly cap
  in 1 day of unguarded use.

## Alternatives rejected

1. **Local Ollama Llama-3 8B as adversarial reviewer**: free + truly
   second-vendor, but significantly lower review quality. Deferred
   to a future ADR if codex costs become unacceptable.
2. **Second isolated Claude Code session as adversarial reviewer**:
   free under subscription, but doesn't truly cross models — same
   training, same family. Reserved for the case where codex hits
   sustained budget refusal.
3. **No Codex; stay at R-L3 indefinitely**: was the pre-Cycle 15
   stance. Revoked by the kickoff doc's operator authorization.

## Linked regression tests

- `tests/test_codex_budget_guard.py` (11 tests covering: normal call,
  daily cap refusal, per-call anomaly, token parsing robustness,
  concurrent calls)
- `tests/test_codex_reviewer.py` (19 tests covering: availability check,
  structured output schema, budget refusal → skipped, codex error →
  error, findings extraction, raw-log persistence, timeout)
- `tests/test_compute_level.py` (2 new tests: R-L4 infra-ready,
  R-L5 main.py-wired)

## Linked cycle

Cycle 20260512-072615 (Cycle 15 per the master ledger).

## Compliance audit (L7 §0)

- §0.1 (no paid Anthropic API): **respected** — unchanged
- §0.2 (no `git push`): **respected**
- §0.3 (no `.env`/secrets reads): **respected**
- §0.4 (tagged rollback): tag `autoevo/pre-20260512-072615` exists
- §0.5 (no paid third-party): **carve-out documented in this ADR**;
  codex via OAuth-subscription within budget guard
- §0.6 (no safety-gate weakening): **respected** — this ADR ADDS a
  gate (budget guard), doesn't weaken one
- §0.7 (LEVEL.md not hand-edited): **respected**
- §0.8 (no FAILURES/CHANGELOG/ADR deletion): **respected** —
  append-only
- §0.10 (judgment call documented): this ADR is that document
- §0.11 (45-min wall clock): cycle wall clock under budget
- §0.12 (only level-up moves): this cycle's work moves R from L3 to L4
