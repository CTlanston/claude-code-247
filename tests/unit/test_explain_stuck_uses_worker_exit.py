"""BR-003 — handle_explain_stuck includes the latest worker_exits so
the operator sees phase, classification, stderr tail, and next action
without having to spelunk through logs.
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest
import yaml

from memory.db import init_db
from orchestrator.command_queue import enqueue
from orchestrator.dispatcher import handle_explain_stuck
from orchestrator.repo_registry import parse_registry, sync_to_db
from orchestrator.task_manager import create_task
from orchestrator.worker_exits import record_worker_exit


def _seed_demo_repo() -> None:
    repos_path = Path(os.environ["CLAUDE247_REPOS_FILE"])
    repos_path.write_text(yaml.safe_dump({"repos": [{
        "id": "demo", "github_owner": "o", "github_repo": "r",
        "local_path": "/tmp/demo", "forbidden_paths": [".env"],
    }]}))
    init_db()
    sync_to_db(parse_registry(repos_path.read_text()))


def _seed_task(repo_id: str = "demo") -> str:
    _seed_demo_repo()
    t = create_task(repo_id, "add greet helper", source="test")
    return t.id


def test_explain_stuck_includes_worker_exits(tmp_path: Path) -> None:
    task_id = _seed_task()
    record_worker_exit(
        task_id=task_id, repo_id="demo", worker_role="runner",
        phase="tests", classification="test_failure",
        command="pytest -q", exit_code=1,
        stderr_tail="FAILED tests/test_x.py::test_thing",
        next_action="open the failing test in your editor",
    )
    cmd = enqueue("explain_stuck", task_id=task_id)
    result = handle_explain_stuck(cmd)
    assert "worker_exits" in result
    we = result["worker_exits"]
    assert isinstance(we, list)
    assert we
    latest = we[-1]
    assert latest["phase"] == "tests"
    assert latest["classification"] == "test_failure"
    assert latest["stderr_tail"].startswith("FAILED")
    assert latest["next_action"]


def test_explain_stuck_with_no_worker_exits(tmp_path: Path) -> None:
    task_id = _seed_task()
    cmd = enqueue("explain_stuck", task_id=task_id)
    result = handle_explain_stuck(cmd)
    # The key is always present so callers can check len()
    assert result.get("worker_exits") == []


def test_explain_stuck_returns_phase_classification_stderr_and_next_action(
    tmp_path: Path,
) -> None:
    task_id = _seed_task()
    record_worker_exit(
        task_id=task_id, repo_id="demo", worker_role="coder",
        phase="coder", classification="claude_cli_failure",
        command="claude --print 'plan'", exit_code=137,
        stdout_tail="(none)",
        stderr_tail="killed",
        next_action="retry with lower token budget",
    )
    cmd = enqueue("explain_stuck", task_id=task_id)
    result = handle_explain_stuck(cmd)
    latest = result["worker_exits"][-1]
    for key in ("phase", "classification", "stderr_tail", "next_action"):
        assert key in latest, f"missing {key}"
