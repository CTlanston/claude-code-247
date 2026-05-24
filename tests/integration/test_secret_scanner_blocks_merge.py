"""M21-P3 Drill A — secret in diff blocks auto-merge end-to-end.

Even with both validators PASS, risk low, and the repo opted in to
auto-merge, a secret-like value in the diff content must produce a
BLOCKED ruling and prevent gh from being called for merge.
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest
import yaml

from memory.db import init_db, open_db
from orchestrator.command_queue import enqueue
from orchestrator.dispatcher import run_once
from orchestrator.repo_registry import parse_registry, sync_to_db

# Reuse the SandboxRunner / SandboxGithub / _all_pass from the
# established golden harness.
from tests.integration.test_sandbox_e2e import (
    SandboxGithub,
    SandboxRunner,
    _all_pass,
    _flip_writes_on,
    _seed,
)


def test_secret_in_diff_blocks_merge(
    fake_repo: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Drill A: GitHub PAT shape in diff -> ruling=BLOCKED."""
    _seed(fake_repo, auto_merge=True)
    _flip_writes_on()
    runner = SandboxRunner()
    gh = SandboxGithub()

    # Inject a secret-bearing diff into the merge policy's scan path.
    from orchestrator import dispatcher as _disp
    from orchestrator.risk_score import DiffStats
    poisoned_diff = "+API_KEY = 'ghp_" + "a" * 36 + "'\n+def f(): pass\n"
    monkeypatch.setattr(
        _disp, "_diff_against_base",
        lambda workspace, base: (
            DiffStats(files=[], insertions=2, deletions=0),
            poisoned_diff,
        ),
    )

    enqueue("start_task", repo_id="sandbox",
            payload={"repo_id": "sandbox", "goal": "drillA"})
    res = run_once(runner=runner, validator_fn=_all_pass, github=gh,
                    notify_fn=lambda **_: None, poll_ci=False)

    assert res.handled
    assert res.result["ruling"]["decision"] == "blocked"
    # The reason must cite the secret scanner explicitly
    assert any("secret" in r.lower() for r in res.result["ruling"]["reasons"])
    # gh merge must NOT have been called
    assert gh.merge_calls == []
    # Task transitioned to failed (BLOCKED -> failed per dispatcher)
    with open_db() as conn:
        task = conn.execute(
            "SELECT status FROM tasks WHERE id = ?",
            (res.result["task_id"],),
        ).fetchone()
        assert task["status"] == "failed"
