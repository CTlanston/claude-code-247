from __future__ import annotations

import os
from pathlib import Path

import pytest

from memory.db import default_db_path, init_db, open_db, schema_version


def test_default_db_path_uses_env(tmp_path: Path) -> None:
    p = default_db_path()
    assert p.parent.exists()
    assert p.parent == Path(os.environ["CLAUDE247_STATE_DIR"])


def test_init_db_creates_file_and_schema(tmp_path: Path) -> None:
    path = init_db()
    assert path.exists()
    with open_db(path) as conn:
        v = schema_version(conn)
        assert v == 1
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    for required in {"repos", "tasks", "task_events", "runs", "commands", "prs",
                     "validator_results", "risk_scores", "budgets", "logs",
                     "memory_items", "decisions", "incidents", "schema_version"}:
        assert required in tables, f"missing table {required}"


def test_init_db_is_idempotent() -> None:
    init_db()
    init_db()
    with open_db() as conn:
        n = conn.execute("SELECT COUNT(*) AS c FROM schema_version").fetchone()["c"]
    assert n == 1


def test_logs_fts_trigger_inserts_into_fts() -> None:
    init_db()
    with open_db() as conn:
        conn.execute(
            """
            INSERT INTO logs (id, created_at, level, component, message)
            VALUES ('log_test_1', '2026-01-01T00:00:00.000Z', 'info', 'test', 'validator failed for task X')
            """
        )
        # FTS should now return the row when queried.
        hit = conn.execute(
            "SELECT COUNT(*) AS c FROM logs_fts WHERE logs_fts MATCH 'validator'"
        ).fetchone()
        assert hit["c"] == 1
