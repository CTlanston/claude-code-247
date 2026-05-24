"""BR-003 — worker_exits table writes and reads.

The record API must be cheap to call at every phase boundary in the
runner / role loop. Reads power the new `claude247 worker-exits` CLI
and feed explain-stuck.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from memory.db import init_db, open_db
from orchestrator.worker_exits import (
    CLASSIFICATIONS,
    WorkerExit,
    list_worker_exits,
    record_worker_exit,
)


def test_record_and_read_roundtrip(tmp_path: Path) -> None:
    init_db()
    we = record_worker_exit(
        task_id="t1", repo_id="r1", worker_role="runner",
        phase="tests", classification="success",
        command="pytest -q", exit_code=0, duration_ms=1230,
    )
    assert isinstance(we, WorkerExit)
    assert we.classification == "success"
    rows = list_worker_exits(task_id="t1")
    assert len(rows) == 1
    assert rows[0].task_id == "t1"
    assert rows[0].phase == "tests"
    assert rows[0].command == "pytest -q"


def test_classifications_include_all_directive_classes() -> None:
    """Per directive Phase 3 §Allowed classifications."""
    required = {
        "success", "test_failure", "lint_failure", "build_failure",
        "claude_cli_failure", "auth_failure", "docker_failure",
        "git_failure", "github_failure", "validator_failure",
        "merge_policy_block", "timeout", "policy_block",
        "unknown_failure",
    }
    assert required <= CLASSIFICATIONS


def test_record_rejects_unknown_classification(tmp_path: Path) -> None:
    init_db()
    with pytest.raises(ValueError):
        record_worker_exit(
            task_id="t", repo_id="r", worker_role="runner",
            phase="tests", classification="banana",
        )


def test_record_persists_optional_fields(tmp_path: Path) -> None:
    init_db()
    record_worker_exit(
        task_id="t", repo_id="r", worker_role="coder",
        phase="coder", classification="claude_cli_failure",
        command="claude --print 'plan'", exit_code=137,
        duration_ms=4500,
        stdout_tail="(no output)",
        stderr_tail="oom-kill",
        error_message="subprocess killed by OOM",
        retryable=True,
        next_action="reduce token budget then retry",
        payload={"signal": "SIGKILL", "ram_used_mb": 2400},
    )
    rows = list_worker_exits(task_id="t")
    r = rows[0]
    assert r.exit_code == 137
    assert r.duration_ms == 4500
    assert r.stderr_tail == "oom-kill"
    assert r.retryable is True
    assert r.next_action == "reduce token budget then retry"
    assert r.payload["signal"] == "SIGKILL"


def test_list_worker_exits_orders_chronologically(tmp_path: Path) -> None:
    init_db()
    for i in range(3):
        record_worker_exit(
            task_id="t", repo_id="r", worker_role="runner",
            phase="tests", classification="success",
            command=f"cmd-{i}",
        )
    rows = list_worker_exits(task_id="t")
    assert [r.command for r in rows] == ["cmd-0", "cmd-1", "cmd-2"]


def test_list_worker_exits_returns_empty_for_unknown_task(tmp_path: Path) -> None:
    init_db()
    record_worker_exit(
        task_id="t-real", repo_id="r", worker_role="runner",
        phase="tests", classification="success",
    )
    assert list_worker_exits(task_id="t-other") == []


def test_record_with_db_initialised_only_on_open(tmp_path: Path) -> None:
    init_db()
    record_worker_exit(
        task_id="t", repo_id="r", worker_role="runner",
        phase="tests", classification="success",
    )
    # Verify it actually hit the table
    with open_db() as conn:
        row = conn.execute(
            "SELECT classification FROM worker_exits WHERE task_id = ?",
            ("t",),
        ).fetchone()
        assert row["classification"] == "success"
