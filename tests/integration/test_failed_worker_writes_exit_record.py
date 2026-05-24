"""BR-003 integration — when a real subprocess inside the worker
fails, a worker_exits row is written with the right classification.

This exercises EvidenceCollector.run_named_commands (the highest-leverage
call site — it's how tests / lint / build are invoked), which writes a
record per command via the new recorder hook.
"""
from __future__ import annotations

from pathlib import Path

from memory.db import init_db
from runner.evidence_collector import EvidenceCollector
from orchestrator.worker_exits import list_worker_exits


def test_pytest_failure_writes_test_failure_record(tmp_path: Path) -> None:
    init_db()
    ec = EvidenceCollector(
        workspace=tmp_path,
        task_spec={"task_id": "t_int", "repo_id": "r_int"},
    )
    # `false` returns exit 1 → a failing "test" command
    ec.run_named_commands(
        "test",
        ["echo 'F'; false"],
    )
    rows = list_worker_exits(task_id="t_int")
    assert rows, "no worker_exits row written"
    # the kind passed to run_named_commands maps directly to phase
    assert rows[0].phase == "tests"
    assert rows[0].classification == "test_failure"
    assert rows[0].exit_code != 0


def test_successful_command_writes_success_record(tmp_path: Path) -> None:
    init_db()
    ec = EvidenceCollector(
        workspace=tmp_path,
        task_spec={"task_id": "t_ok", "repo_id": "r_ok"},
    )
    ec.run_named_commands("test", ["echo ok"])
    rows = list_worker_exits(task_id="t_ok")
    assert rows
    assert rows[-1].classification == "success"
    assert rows[-1].exit_code == 0
