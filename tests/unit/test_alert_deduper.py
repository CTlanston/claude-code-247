from __future__ import annotations

from memory.db import init_db
from orchestrator import alert_deduper


def test_emit_first_returns_count_one() -> None:
    init_db()
    a = alert_deduper.emit(alert_type="task_stuck", severity="warn",
                            message="stuck", repo_id="demo", task_id="t1")
    assert a.count == 1


def test_emit_within_window_increments() -> None:
    init_db()
    a1 = alert_deduper.emit(alert_type="task_stuck", severity="warn",
                             message="stuck", repo_id="demo", task_id="t1")
    a2 = alert_deduper.emit(alert_type="task_stuck", severity="warn",
                             message="stuck", repo_id="demo", task_id="t1")
    assert a1.id == a2.id
    assert a2.count == 2


def test_emit_different_fingerprint_creates_new_row() -> None:
    init_db()
    a = alert_deduper.emit(alert_type="task_stuck", severity="warn",
                            message="m", repo_id="alpha", task_id="t1")
    b = alert_deduper.emit(alert_type="task_stuck", severity="warn",
                            message="m", repo_id="beta", task_id="t1")
    assert a.id != b.id


def test_emit_outside_dedup_window_creates_new_row() -> None:
    init_db()
    a1 = alert_deduper.emit(alert_type="t", severity="info",
                             message="x", dedup_minutes=0)  # window = 0 min
    a2 = alert_deduper.emit(alert_type="t", severity="info",
                             message="x", dedup_minutes=0)
    # With window=0, the prior is always considered out-of-window.
    assert a1.id != a2.id


def test_acknowledge_removes_from_list_open() -> None:
    init_db()
    a = alert_deduper.emit(alert_type="t", severity="info", message="x")
    assert any(o.id == a.id for o in alert_deduper.list_open())
    alert_deduper.acknowledge(a.id)
    assert not any(o.id == a.id for o in alert_deduper.list_open())
