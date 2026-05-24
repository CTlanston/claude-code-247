"""M21-P2 — integration: a failed worker phase always writes a row.

Even when the dispatcher's handler short-circuits because something
blew up, the operator must be able to read the worker_exits log and
see exactly which phase failed and why. This test exercises that
contract end-to-end on a deliberately failing phase.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from memory.db import init_db
from orchestrator.worker_exits import list_worker_exits, record_phase


def test_phase_failure_recorded_with_full_metadata(tmp_path: Path) -> None:
    init_db()
    try:
        with record_phase(
            task_id="int_t1", repo_id="int_r1",
            phase="open_pr", worker_role="dispatcher",
        ) as rec:
            rec.command = "gh pr create"
            rec.metadata["attempt"] = 1
            raise PermissionError("403: insufficient scope")
    except PermissionError:
        pass  # caller will handle

    rows = list_worker_exits(task_id="int_t1")
    assert len(rows) == 1, "exactly one failure row written"
    r = rows[0]
    # Lifecycle fields
    assert r.status == "failure"
    assert r.started_at is not None and r.finished_at is not None
    assert r.duration_ms is not None and r.duration_ms >= 0
    # Error attribution
    assert r.error_type == "PermissionError"
    assert "403" in (r.error_message or "")
    # Auth-keyword heuristic catches "permission" -> auth_failure
    assert r.classification == "auth_failure"
    # Operator-visible metadata preserved
    assert r.command == "gh pr create"
    assert r.payload.get("attempt") == 1


def test_phase_skipped_recorded_with_reason(tmp_path: Path) -> None:
    init_db()
    with record_phase(
        task_id="int_t2", repo_id="int_r2",
        phase="auto_merge", worker_role="dispatcher",
    ) as rec:
        # e.g., merge_policy decided WAITING_APPROVAL so we don't merge
        rec.skip("merge ruling = waiting_approval; nothing to merge")

    rows = list_worker_exits(task_id="int_t2")
    assert rows[0].status == "skipped"
    assert "waiting_approval" in rows[0].payload["skip_reason"]


def test_multiple_phases_chained_chronologically(tmp_path: Path) -> None:
    """Realistic mini-pipeline: prepare_workspace -> tests -> push.
    All three should land in order with consistent timing fields."""
    init_db()
    with record_phase(task_id="int_t3", repo_id="int_r3",
                       phase="prepare_workspace"):
        pass
    with record_phase(task_id="int_t3", repo_id="int_r3",
                       phase="tests") as rec:
        rec.metadata["passed"] = 92
    with record_phase(task_id="int_t3", repo_id="int_r3",
                       phase="push") as rec:
        rec.command = "git push origin agent/x"

    rows = list_worker_exits(task_id="int_t3")
    assert [r.phase for r in rows] == ["prepare_workspace", "tests", "push"]
    # Each row has started_at, finished_at, status=success
    for r in rows:
        assert r.status == "success"
        assert r.started_at is not None
        assert r.finished_at is not None
        assert r.duration_ms is not None and r.duration_ms >= 0
    # tests row has passed=92 metadata
    tests_row = next(r for r in rows if r.phase == "tests")
    assert tests_row.payload["passed"] == 92
