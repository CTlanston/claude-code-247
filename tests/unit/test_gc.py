from __future__ import annotations

import os
import time
from pathlib import Path

import pytest

from memory.db import init_db, open_db
from orchestrator import gc as gc_mod
from orchestrator.command_queue import enqueue
from orchestrator.ids import utc_now_iso
from orchestrator.log_indexer import write as log_write


def test_run_gc_no_workspaces_no_logs_no_orphans() -> None:
    init_db()
    res = gc_mod.run_gc(workspace_days=0, log_days=10**6, orphan_minutes=10**6)
    assert res.workspaces_pruned == 0
    assert res.log_rows_pruned == 0
    assert res.orphan_commands_failed == 0


def test_prune_workspaces_drops_old_dirs(tmp_path: Path) -> None:
    init_db()
    ws_root = tmp_path / "ws"
    ws_root.mkdir()
    fresh = ws_root / "fresh"
    fresh.mkdir()
    (fresh / "file").write_text("x")
    stale = ws_root / "stale"
    stale.mkdir()
    (stale / "file").write_text("x")
    old_mtime = time.time() - 100 * 86400
    os.utime(stale, (old_mtime, old_mtime))
    res = gc_mod.run_gc(workspace_root=ws_root, workspace_days=14,
                        log_days=10**6, orphan_minutes=10**6)
    assert res.workspaces_pruned == 1
    assert fresh.exists()
    assert not stale.exists()


def test_prune_logs_drops_old_rows() -> None:
    init_db()
    # Insert a "fresh" row via the normal writer (uses utc_now_iso).
    log_write(level="info", component="t", message="fresh")
    # Insert a row 60 days back by direct DB write.
    with open_db() as conn:
        conn.execute(
            "INSERT INTO logs (id, created_at, level, component, message) "
            "VALUES (?, ?, ?, ?, ?)",
            ("old1", "2020-01-01T00:00:00.000Z", "info", "t", "stale"),
        )
    res = gc_mod.run_gc(workspace_days=10**6, log_days=30,
                        orphan_minutes=10**6)
    assert res.log_rows_pruned == 1
    with open_db() as conn:
        remaining = list(conn.execute("SELECT message FROM logs"))
    assert any(r["message"] == "fresh" for r in remaining)
    assert not any(r["message"] == "stale" for r in remaining)


def test_recover_orphans_fails_stuck_running_commands() -> None:
    init_db()
    c = enqueue("set_mode", payload={"mode": "running"})
    # Pretend we claimed it 2 hours ago and never finished.
    old = "2026-05-24T00:00:00.000Z"
    with open_db() as conn:
        conn.execute(
            "UPDATE commands SET status = 'running', started_at = ? WHERE id = ?",
            (old, c.id),
        )
    res = gc_mod.run_gc(workspace_days=10**6, log_days=10**6,
                        orphan_minutes=60,
                        now=time.time() + 9999)
    assert res.orphan_commands_failed == 1
    with open_db() as conn:
        row = conn.execute("SELECT status, error FROM commands WHERE id = ?",
                            (c.id,)).fetchone()
        assert row["status"] == "failed"
        assert "orphan recovery" in (row["error"] or "")
