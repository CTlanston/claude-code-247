# ADR-0001: Zero billable cost at INSERT time under subscription mode

## Context

V3 E2E test (2026-05-11) on issue #16 triggered a Guardian pause titled
"token spike". The user was on a Claude subscription (`sk-ant-oat01-...`),
so per-call cost should always be $0. But Guardian queries `runs.cost_usd`
directly from SQLite, and the CLI was emitting non-zero estimated USD figures
into that column. The estimates accumulated across roles and crossed the 2×
moving-average threshold, false-pausing the supervisor.

The pre-V4 partial mitigation was to mask cost only in `metrics.json`
(the file Guardian was *supposed* to read). But any code path that
queried the DB directly — Guardian's audit query, ad-hoc reports, the
circuit-breaker — saw the raw estimates and made wrong decisions.

## Decision

Move cost zeroing from "compute time on read" to "force zero at INSERT time"
under subscription mode. Specifically:

- New module `orchestrator/billable.py`:
  - `is_subscription_mode(env=None) -> bool` — detects
    `CLAUDE_CODE_OAUTH_TOKEN` env or `ANTHROPIC_API_KEY` starting with
    `sk-ant-oat01-`.
  - `to_billable_cost(raw_cost_usd, *, in_tokens=0, out_tokens=0, env=None) -> float`
    — subscription mode → 0.0; zero-token guard → 0.0; otherwise pass
    through clamped to ≥0.
  - `load_budget_metrics(state_dir, env=None) -> dict` — helper that
    enforces the same semantics when computing daily totals.

- `orchestrator/db.py:record_run` now calls
  `billable.to_billable_cost(cost, in_tokens=in_tokens, out_tokens=out_tokens)`
  BEFORE the SQL INSERT.

This means the DB itself stores the billable figure, not the raw estimate.
Every reader (Guardian, circuit-breaker, ad-hoc query, dashboard) agrees by
construction.

## Consequences

Good:
- Guardian cannot false-pause on phantom subscription cost.
- Single source of truth; no need to remember to mask in N places.
- Zero-token-zero-cost guard handles CLI ghost-cost on early-exit.
- API-mode (`sk-ant-api03-`) is unaffected — passes through as before.

Bad:
- The raw CLI cost estimate is lost from the DB. If a future analysis wanted
  to compare "what would this have cost on API" the raw figure is gone.
  Mitigation: it's logged in the per-role stdout that we capture to
  `reports/runs/`, just not in the structured DB column.
- A user who switches mid-day from subscription to API (uncommon) will see
  the DB row's `cost_usd` change semantics from "always 0" to "real $$$".
  Mitigation: that's the correct semantics for what they did; they switched.

## Alternatives Rejected

- **Mask only in metrics.json (V3 partial fix).** Rejected: any other query
  path still sees raw cost. Defense-in-depth is correct.
- **Skip the INSERT entirely under subscription mode.** Rejected: we still
  want row presence so audit / call counting works; only the `cost_usd`
  column is wrong.
- **Compute cost mode at read time via JOIN on auth-metadata table.**
  Rejected: complexity not justified; the env-var read is fast and
  unambiguous.

## Linked regression test

- `tests/test_v4_hardening.py::test_db_record_run_zeros_cost_under_subscription`
- `tests/test_v4_hardening.py::test_billable_load_budget_metrics_subscription`
- `tests/test_v4_hardening.py::test_billable_to_billable_cost_api_mode_passes_through`
- `tests/test_v4_e2e_replay.py::test_v4_scenario_16_guardian_does_not_false_pause_under_subscription`
- `tests/test_v4_e2e_replay.py::test_v4_scenario_16_clean_cycle_under_api_mode_preserves_cost`

## Linked cycle

Original implementation: commit `110e7bd` (V4 Track 1, pre-L7).
Ratified into L7 memory: Cycle `20260512-042701` (Bootstrap).
