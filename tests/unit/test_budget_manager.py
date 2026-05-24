from __future__ import annotations

import pytest

from memory.db import init_db
from orchestrator import budget_manager


def test_get_snapshot_zero_when_no_row() -> None:
    init_db()
    s = budget_manager.get_snapshot("demo")
    assert s.tasks_count == 0
    assert s.estimated_api_cost == 0.0


def test_increment_creates_row_and_increments() -> None:
    init_db()
    budget_manager.increment("demo", counter="tasks_count")
    budget_manager.increment("demo", counter="tasks_count", by=2)
    budget_manager.increment("demo", counter="local_cc_run_count", by=3)
    budget_manager.increment("demo", counter="worker_runs_count",
                              by=1, cost_delta=0.05)
    s = budget_manager.get_snapshot("demo")
    assert s.tasks_count == 3
    assert s.local_cc_run_count == 3
    assert s.worker_runs_count == 1
    assert s.estimated_api_cost == pytest.approx(0.05)


def test_increment_rejects_unknown_counter() -> None:
    init_db()
    with pytest.raises(ValueError):
        budget_manager.increment("demo", counter="nope")


def test_check_caps_warns_when_exceeded() -> None:
    init_db()
    raw = {"budget": {"max_tasks_per_day": 1}}
    budget_manager.increment("demo", counter="tasks_count", by=2)
    ok, reasons = budget_manager.check_caps("demo", repo_raw=raw)
    assert ok is False
    assert any("max_tasks_per_day" in r for r in reasons)
