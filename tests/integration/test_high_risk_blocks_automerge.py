"""M21-P3 Drill C — high-risk path touch blocks auto-merge.

If the change touches a forbidden_path (e.g. `.env`, `.github/**`,
`CLAUDE.md`), the risk_score factor `forbidden_path_touch` adds 100
which exceeds the high threshold. The dispatcher must rule BLOCKED
regardless of validator PASS / risk_score otherwise being low.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from memory.db import open_db
from orchestrator.command_queue import enqueue
from orchestrator.dispatcher import run_once

from tests.integration.test_sandbox_e2e import (
    SandboxGithub,
    SandboxRunner,
    _all_pass,
    _flip_writes_on,
    _seed,
)


def test_forbidden_path_touch_blocks_merge(
    fake_repo: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Drill C: diff touches `.env` -> risk=high -> ruling=BLOCKED."""
    _seed(fake_repo, auto_merge=True)
    _flip_writes_on()
    runner = SandboxRunner()
    gh = SandboxGithub()

    # Diff that hits a forbidden path. The DiffStats.files list is what
    # compute_risk uses to decide forbidden_path_touch.
    from orchestrator import dispatcher as _disp
    from orchestrator.risk_score import DiffStats
    diff = DiffStats(
        files=[".env", "src/lib.py"],
        insertions=10, deletions=0,
    )
    monkeypatch.setattr(
        _disp, "_diff_against_base",
        lambda workspace, base: (diff, "+SAFE=ok\n"),
    )

    enqueue("start_task", repo_id="sandbox",
            payload={"repo_id": "sandbox", "goal": "drillC"})
    res = run_once(runner=runner, validator_fn=_all_pass, github=gh,
                    notify_fn=lambda **_: None, poll_ci=False)

    assert res.handled
    # Either ruling=blocked or the risk band is high — both satisfy "don't merge"
    assert res.result["ruling"]["decision"] == "blocked"
    assert gh.merge_calls == []
    with open_db() as conn:
        risk = conn.execute(
            "SELECT score, level FROM risk_scores WHERE task_id = ?",
            (res.result["task_id"],),
        ).fetchone()
        assert risk["score"] >= 100  # forbidden_path_touch weight
        assert risk["level"] == "high"
