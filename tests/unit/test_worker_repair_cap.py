"""Test that per-task max_repair_attempts threads through spec → worker."""
from __future__ import annotations

import json
from pathlib import Path

from orchestrator.repo_registry import RepoEntry
from orchestrator.runner_manager import RunnerManager


def test_build_task_spec_includes_repair_cap() -> None:
    repo = RepoEntry(
        id="demo", name="demo", github_owner="o", github_repo="r",
        local_path="/tmp/x", default_branch="main", enabled=True, risk_level="low",
        raw={
            "id": "demo",
            "budget": {"max_repair_attempts_per_task": 1},
            "forbidden_paths": [".env"],
        },
    )
    rm = RunnerManager(backend="local", registry=[repo])
    spec = rm.build_task_spec(task_id="t1", repo=repo, goal="g", branch="b")
    assert spec["max_repair_attempts"] == 1


def test_build_task_spec_defaults_to_three() -> None:
    repo = RepoEntry(
        id="demo", name="demo", github_owner="o", github_repo="r",
        local_path="/tmp/x", default_branch="main", enabled=True, risk_level="low",
        raw={"id": "demo", "forbidden_paths": [".env"]},
    )
    rm = RunnerManager(backend="local", registry=[repo])
    spec = rm.build_task_spec(task_id="t1", repo=repo, goal="g", branch="b")
    assert spec["max_repair_attempts"] == 3
