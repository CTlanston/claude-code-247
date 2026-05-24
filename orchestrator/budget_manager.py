"""Per-repo per-day budget counters.

Walks against the ``budgets`` table; one row per (repo_id, date). All
mutators are upsert so callers don't have to worry about row existence.

When a counter exceeds its configured cap, ``check_caps`` returns the
offending counter so the orchestrator can pause the repo and notify.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from memory.db import open_db
from orchestrator.config import load_config
from orchestrator.ids import make_id, utc_now_iso


def _today() -> str:
    return time.strftime("%Y-%m-%d", time.gmtime())


_COUNTERS = (
    "tasks_count", "worker_runs_count", "validator_runs_count",
    "repair_attempts_count", "local_cc_run_count",
)


@dataclass(frozen=True)
class BudgetSnapshot:
    repo_id: str
    date: str
    tasks_count: int
    worker_runs_count: int
    validator_runs_count: int
    repair_attempts_count: int
    estimated_api_cost: float
    local_cc_run_count: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "repo_id": self.repo_id, "date": self.date,
            "tasks_count": self.tasks_count,
            "worker_runs_count": self.worker_runs_count,
            "validator_runs_count": self.validator_runs_count,
            "repair_attempts_count": self.repair_attempts_count,
            "estimated_api_cost": self.estimated_api_cost,
            "local_cc_run_count": self.local_cc_run_count,
        }


def get_snapshot(repo_id: str, *, date: str | None = None,
                 db_path: Path | str | None = None) -> BudgetSnapshot:
    d = date or _today()
    with open_db(db_path) as conn:
        row = conn.execute(
            "SELECT * FROM budgets WHERE repo_id = ? AND date = ?",
            (repo_id, d),
        ).fetchone()
    if row is None:
        return BudgetSnapshot(repo_id=repo_id, date=d, tasks_count=0,
                              worker_runs_count=0, validator_runs_count=0,
                              repair_attempts_count=0, estimated_api_cost=0.0,
                              local_cc_run_count=0)
    return BudgetSnapshot(
        repo_id=repo_id, date=d,
        tasks_count=row["tasks_count"], worker_runs_count=row["worker_runs_count"],
        validator_runs_count=row["validator_runs_count"],
        repair_attempts_count=row["repair_attempts_count"],
        estimated_api_cost=float(row["estimated_api_cost"] or 0.0),
        local_cc_run_count=row["local_cc_run_count"],
    )


def increment(
    repo_id: str,
    *,
    counter: str,
    by: int = 1,
    cost_delta: float = 0.0,
    date: str | None = None,
    db_path: Path | str | None = None,
) -> BudgetSnapshot:
    if counter not in _COUNTERS:
        raise ValueError(f"unknown counter {counter!r}; allowed: {_COUNTERS}")
    d = date or _today()
    now = utc_now_iso()
    with open_db(db_path) as conn:
        existing = conn.execute(
            "SELECT id FROM budgets WHERE repo_id = ? AND date = ?",
            (repo_id, d),
        ).fetchone()
        if existing is None:
            conn.execute(
                """
                INSERT INTO budgets (id, repo_id, date, updated_at)
                VALUES (?, ?, ?, ?)
                """,
                (make_id("bud"), repo_id, d, now),
            )
        conn.execute(
            f"UPDATE budgets SET {counter} = {counter} + ?, "
            "estimated_api_cost = estimated_api_cost + ?, updated_at = ? "
            "WHERE repo_id = ? AND date = ?",
            (by, cost_delta, now, repo_id, d),
        )
    return get_snapshot(repo_id, date=d, db_path=db_path)


def check_caps(repo_id: str, *, repo_raw: dict[str, Any] | None = None,
               date: str | None = None, db_path: Path | str | None = None
               ) -> tuple[bool, list[str]]:
    """Return (within_caps, list_of_exceedance_reasons)."""
    snap = get_snapshot(repo_id, date=date, db_path=db_path)
    cfg = load_config()
    defaults = cfg.get("repo_defaults.budget") or {}
    budget = ((repo_raw or {}).get("budget")) or defaults
    reasons: list[str] = []
    pairs = (
        ("max_tasks_per_day", snap.tasks_count),
        ("max_worker_runs_per_day", snap.worker_runs_count),
        ("max_validator_runs_per_day", snap.validator_runs_count),
    )
    for cap_key, value in pairs:
        cap = budget.get(cap_key)
        if cap is not None and value > int(cap):
            reasons.append(f"{cap_key}: {value} > {cap}")
    return (not reasons, reasons)
