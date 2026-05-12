"""Billable-cost helpers.

Single source of truth for "what cost should the orchestrator's budget
controls consider?". Under subscription auth (OAuth `sk-ant-oat01-...`),
the CLI returns estimated USD figures for observability — but the user is
NOT being billed per-token, so subjecting Guardian / circuit-breaker /
daily-cost reports to those estimates is wrong.

API mode (sk-ant-api03-...) IS billable; pass through.

This module is intentionally tiny and side-effect-free. Tests live in
tests/test_billable.py and pass without any DB or network access.
"""
from __future__ import annotations

import os
from typing import Optional


SUBSCRIPTION_TOKEN_PREFIX = "sk-ant-oat01-"


def is_subscription_mode(env: Optional[dict] = None) -> bool:
    """True if the active auth token is a subscription / OAuth token.

    Resolution order:
      1. `CLAUDE_CODE_OAUTH_TOKEN` env var present (always subscription)
      2. `ANTHROPIC_API_KEY` env var starts with `sk-ant-oat01-`
      3. otherwise False (API key path)
    """
    env = env or os.environ
    if env.get("CLAUDE_CODE_OAUTH_TOKEN"):
        return True
    return (env.get("ANTHROPIC_API_KEY") or "").startswith(SUBSCRIPTION_TOKEN_PREFIX)


def to_billable_cost(raw_cost_usd: float, *,
                     in_tokens: int = 0, out_tokens: int = 0,
                     env: Optional[dict] = None) -> float:
    """Convert a raw CLI cost estimate into a billable-cost figure.

    Rules (in order):
      - Subscription mode → always 0.0 (user pre-paid; no per-call spend).
      - Zero-token-zero-cost guard: if both token counts are zero, force 0.0
        regardless of mode (CLI sometimes emits ghost cost on early-exit;
        recording it as real $$$ poisons the metrics table).
      - Otherwise pass `raw_cost_usd` through, clamped to ≥0.
    """
    if is_subscription_mode(env):
        return 0.0
    if (in_tokens or 0) == 0 and (out_tokens or 0) == 0:
        return 0.0
    try:
        return max(0.0, float(raw_cost_usd or 0.0))
    except (TypeError, ValueError):
        return 0.0


def load_budget_metrics(state_dir, env: Optional[dict] = None) -> dict:
    """Return a budget-relevant metrics dict for Guardian / breaker.

    Uses billable-cost semantics: under subscription mode `daily_cost_usd`
    is always 0; otherwise it's the real sum from the metrics table.
    Importing `orchestrator.db` lazily — this helper is also used in unit
    tests that don't have a writable STATE_DIR.
    """
    from pathlib import Path
    state_dir = Path(state_dir)
    metrics = {
        "daily_cost_usd": 0.0,
        "is_subscription": is_subscription_mode(env),
        "billable_cost_basis": "subscription=0; api=db.daily_cost_usd",
    }
    if metrics["is_subscription"]:
        return metrics

    # API mode: compute from DB.
    try:
        import sqlite3
        import time
        db_path = state_dir / "orchestrator.db"
        if not db_path.exists():
            return metrics
        bucket_start = int((time.time() - 86400) // 300)
        with sqlite3.connect(str(db_path), timeout=5) as c:
            row = c.execute(
                "SELECT COALESCE(SUM(cost_usd), 0) FROM metrics WHERE bucket_at >= ?",
                (bucket_start,),
            ).fetchone()
            metrics["daily_cost_usd"] = float(row[0] or 0.0)
    except Exception:  # noqa: BLE001
        # Defensive: never let metrics-collection crash the supervisor.
        pass
    return metrics
