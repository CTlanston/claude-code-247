"""M21-P3 Drill D — budget exceeded defers new tasks.

When a repo is at or above its daily task cap, the dispatcher must
defer new start_task commands and notify the operator. No worker
runs, no PR opens.

The current dispatcher behavior (verified during M20-P3 budget bumps)
is "deferred": no task is created and the command result records the
exceedance reason. This is the safety-property version of the
directive's "repo paused" — work doesn't happen — but it's worth
recording the deviation explicitly: the dispatcher does not currently
flip ``system_state.pause_repo(repo_id)`` automatically when a cap is
hit. Filed for M22 if escalation to a hard pause is desired.
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest
import yaml

from memory.db import init_db, open_db
from orchestrator import budget_manager
from orchestrator.command_queue import enqueue
from orchestrator.dispatcher import run_once
from orchestrator.repo_registry import parse_registry, sync_to_db

from tests.integration.test_sandbox_e2e import (
    SandboxGithub,
    SandboxRunner,
    _flip_writes_on,
)


def _seed_with_low_budget(fake_repo: Path, cap: int) -> None:
    repos_path = Path(os.environ["CLAUDE247_REPOS_FILE"])
    repos_path.write_text(yaml.safe_dump({"repos": [{
        "id": "sandbox",
        "github_owner": "owner",
        "github_repo": "sandbox-repo",
        "local_path": str(fake_repo),
        "default_branch": "main",
        "forbidden_paths": [".env"],
        "auto_merge": {"enabled": True, "max_risk_score": 30,
                        "max_changed_lines": 300, "method": "squash"},
        "budget": {
            "max_tasks_per_day": cap,
            "max_worker_runs_per_day": 100,
            "max_validator_runs_per_day": 100,
            "max_repair_attempts_per_task": 2,
        },
    }]}))
    init_db()
    sync_to_db(parse_registry(repos_path.read_text()))


def test_budget_exceeded_defers_start_task(fake_repo: Path) -> None:
    _seed_with_low_budget(fake_repo, cap=1)
    _flip_writes_on()
    runner = SandboxRunner()
    gh = SandboxGithub()

    # Pre-fill counter so the very first start_task is over budget
    budget_manager.increment("sandbox", counter="tasks_count", by=2)

    notifications: list[dict] = []
    def _notify(**kw):
        notifications.append(kw)

    enqueue("start_task", repo_id="sandbox",
            payload={"repo_id": "sandbox", "goal": "drillD"})
    res = run_once(runner=runner, validator_fn=None, github=gh,
                    notify_fn=_notify, poll_ci=False)

    assert res.handled
    assert res.result.get("deferred") is True
    assert "budget exceeded" in res.result.get("reason", "")
    # The runner / github mocks must NOT have been touched
    assert runner.events == []
    assert gh.create_calls == []
    # Operator notification was emitted
    assert any(n.get("event") == "budget_exceeded" for n in notifications), \
        "budget_exceeded notification must fire"
    # No task was created in the DB
    with open_db() as conn:
        n = conn.execute("SELECT COUNT(*) FROM tasks WHERE repo_id = 'sandbox'").fetchone()[0]
        assert n == 0
