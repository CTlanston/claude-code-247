"""M21-P3 Drill E — stop-all emergency kill.

`claude247 stop-all` pauses the system state and transitions every
active task to a paused/cancelled terminal. Subsequent dispatcher
ticks must refuse to claim new work until the operator resumes.
"""
from __future__ import annotations

from pathlib import Path

from memory.db import open_db
from orchestrator import system_state
from orchestrator.command_queue import enqueue
from orchestrator.dispatcher import run_once
from orchestrator.task_manager import create_task, get_task

from tests.integration.test_sandbox_e2e import (
    SandboxGithub,
    SandboxRunner,
    _all_pass,
    _seed,
)


def test_stop_all_pauses_system_and_cancels_active_tasks(
    fake_repo: Path,
) -> None:
    _seed(fake_repo, auto_merge=True)
    # Two active tasks before stop-all is called
    t1 = create_task("sandbox", "first goal")
    t2 = create_task("sandbox", "second goal")
    runner = SandboxRunner()
    gh = SandboxGithub()

    enqueue("stop_all", source="cli")
    res = run_once(runner=runner, validator_fn=_all_pass, github=gh,
                    notify_fn=lambda **_: None, poll_ci=False)
    assert res.handled
    # System paused
    assert system_state.is_system_paused() is True
    # Active tasks transitioned to cancelled (or paused — whichever
    # the handler chose). Critical safety property: NOT still "queued".
    for tid in (t1.id, t2.id):
        t = get_task(tid)
        assert t.status in ("cancelled", "paused", "stopped")
    # Dispatcher refuses new work after pause
    enqueue("start_task", repo_id="sandbox",
            payload={"repo_id": "sandbox", "goal": "post-stop"})
    res2 = run_once(runner=runner, validator_fn=_all_pass, github=gh,
                     notify_fn=lambda **_: None, poll_ci=False)
    # Either the dispatcher reports system paused, or it doesn't
    # process the new start_task — either is acceptable.
    assert (
        res2.reason == "system paused"
        or (res2.handled and res2.status == "succeeded"
            and res2.result.get("deferred"))
    )
    # SandboxRunner never got called for the new task
    assert all("post-stop" not in str(e) for e in runner.events)
