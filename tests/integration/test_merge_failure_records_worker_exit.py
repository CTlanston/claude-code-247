"""M21-P3 Drill F — gh merge failure records a worker_exits row.

When `gh pr merge` errors during the auto_merge phase, the dispatcher
must:
  - leave the task non-merged (status=failed)
  - record a worker_exits row with phase=auto_merge,
    status=failure, error_type=GitHubError, classification=
    github_failure
  - keep the merge_error in the summary so logs can surface it

This is the M21-P2 instrumentation paying off: explain-stuck +
`claude247 task-phases` give the operator immediate visibility into
which gate the run died at.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from memory.db import open_db
from orchestrator.command_queue import enqueue
from orchestrator.dispatcher import run_once
from orchestrator.github_client import GitHubError
from orchestrator.worker_exits import list_worker_exits

from tests.integration.test_sandbox_e2e import (
    SandboxRunner,
    _all_pass,
    _flip_writes_on,
    _seed,
)


class FailingMergeGithub:
    """SandboxGithub variant that fails on merge_pr."""
    GitHubError = GitHubError

    def __init__(self):
        self.create_calls = []
        self.merge_calls = []
        self.ready_calls = []

    def create_draft_pr(self, *, repo, branch, title, body, base="main",
                         label=None, workspace=None):
        from orchestrator.github_client import PullRequest
        self.create_calls.append({"repo": repo, "branch": branch})
        return PullRequest(repo=repo, number=999,
                           url=f"https://github.com/{repo}/pull/999",
                           branch=branch, title=title, state="draft", raw={})

    def merge_pr(self, *, repo, number, method, delete_branch, auto, admin):
        self.merge_calls.append({"repo": repo, "number": number})
        raise GitHubError("403: branch protection check failed")

    def mark_ready(self, repo, number):
        self.ready_calls.append((repo, number))
        return True

    def pr_checks(self, repo, number):
        return []


def test_merge_failure_records_worker_exit_for_auto_merge_phase(
    fake_repo: Path,
) -> None:
    _seed(fake_repo, auto_merge=True)
    _flip_writes_on()
    runner = SandboxRunner()
    gh = FailingMergeGithub()

    enqueue("start_task", repo_id="sandbox",
            payload={"repo_id": "sandbox", "goal": "drillF"})
    res = run_once(runner=runner, validator_fn=_all_pass, github=gh,
                    notify_fn=lambda **_: None, poll_ci=False)

    assert res.handled
    # PR was created and merge was attempted (and failed)
    assert gh.create_calls, "PR should still be created"
    assert gh.merge_calls, "merge_pr should be attempted"
    # Task ended up failed, not merged
    with open_db() as conn:
        task = conn.execute(
            "SELECT status FROM tasks WHERE id = ?",
            (res.result["task_id"],),
        ).fetchone()
        assert task["status"] == "failed"

    # Worker_exits captures the auto_merge phase failure (M21-P2 wins)
    rows = list_worker_exits(task_id=res.result["task_id"])
    auto_merge_rows = [r for r in rows if r.phase == "auto_merge"]
    assert auto_merge_rows, "auto_merge phase row missing"
    row = auto_merge_rows[-1]
    assert row.status == "failure"
    assert row.classification == "github_failure"
    assert row.error_type in ("GitHubError",)
    assert "403" in (row.error_message or "")
