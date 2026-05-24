"""M21-P2 — worker_exits schema v4 migration.

The v4 migration is additive: it adds ``status``, ``started_at``,
``finished_at``, ``error_type`` to existing ``worker_exits`` rows.
It must:
  - run cleanly on a brand-new DB (table doesn't exist yet)
  - run cleanly on a fresh init_db() called more than once
  - leave existing v3 rows intact (new columns are NULL)
  - allow new rows to populate the new columns
"""
from __future__ import annotations

from pathlib import Path

from memory.db import init_db, open_db
from orchestrator.worker_exits import record_worker_exit


def _columns(db_path: Path, table: str) -> list[str]:
    with open_db(db_path) as conn:
        return [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]


def test_v4_columns_present_on_fresh_db(tmp_path: Path) -> None:
    db = tmp_path / "fresh.db"
    init_db(db)
    cols = _columns(db, "worker_exits")
    for required in ("status", "started_at", "finished_at", "error_type"):
        assert required in cols, f"v4 column missing: {required}"


def test_v4_migration_idempotent(tmp_path: Path) -> None:
    db = tmp_path / "idem.db"
    init_db(db)
    init_db(db)  # second init must not error or duplicate
    cols = _columns(db, "worker_exits")
    # No duplicate columns
    assert len(cols) == len(set(cols))


def test_v4_columns_default_to_null(tmp_path: Path) -> None:
    db = tmp_path / "nulls.db"
    init_db(db)
    record_worker_exit(
        task_id="t", repo_id="r", worker_role="runner",
        phase="tests", classification="success",
        db_path=db,
    )
    with open_db(db) as conn:
        row = conn.execute(
            "SELECT status, started_at, finished_at, error_type "
            "FROM worker_exits WHERE task_id = ?",
            ("t",),
        ).fetchone()
    assert row["status"] is None
    assert row["started_at"] is None
    assert row["finished_at"] is None
    assert row["error_type"] is None


def test_v4_columns_writable(tmp_path: Path) -> None:
    db = tmp_path / "writable.db"
    init_db(db)
    record_worker_exit(
        task_id="t", repo_id="r", worker_role="dispatcher",
        phase="push", classification="success",
        status="success", started_at="2026-05-24T22:00:00.000Z",
        finished_at="2026-05-24T22:00:01.500Z",
        error_type=None,
        db_path=db,
    )
    with open_db(db) as conn:
        row = conn.execute(
            "SELECT status, started_at, finished_at, error_type "
            "FROM worker_exits WHERE task_id = ?",
            ("t",),
        ).fetchone()
    assert row["status"] == "success"
    assert row["started_at"] == "2026-05-24T22:00:00.000Z"
    assert row["finished_at"] == "2026-05-24T22:00:01.500Z"
    assert row["error_type"] is None


def test_schema_version_4_recorded(tmp_path: Path) -> None:
    db = tmp_path / "ver.db"
    init_db(db)
    with open_db(db) as conn:
        v = conn.execute("SELECT MAX(version) FROM schema_version").fetchone()[0]
    assert v >= 4
