from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import pytest
import yaml

from memory.db import init_db, open_db
from orchestrator import system_state
from orchestrator.command_queue import enqueue, get_command, list_commands
from orchestrator.dispatcher import HANDLERS, run_once
from orchestrator.ids import make_id, utc_now_iso
from orchestrator.repo_registry import parse_registry, sync_to_db
from orchestrator.task_manager import TaskStatus, create_task, get_task


def _seed_demo() -> None:
    repos_path = Path(os.environ["CLAUDE247_REPOS_FILE"])
    repos_path.write_text(yaml.safe_dump({"repos": [{
        "id": "demo", "github_owner": "o", "github_repo": "r",
        "local_path": "/tmp/demo", "forbidden_paths": [".env"],
    }]}))
    init_db()
    sync_to_db(parse_registry(repos_path.read_text()))


def test_run_once_idle_when_queue_empty() -> None:
    init_db()
    res = run_once()
    assert res.handled is False
    assert res.reason == "queue empty"


def test_run_once_idle_when_system_paused() -> None:
    init_db()
    system_state.pause_system()
    enqueue("set_mode", payload={"mode": "running"})
    res = run_once()
    assert res.handled is False
    assert res.reason == "system paused"


def test_set_mode_resume_clears_pause() -> None:
    init_db()
    system_state.pause_system()
    # Have to bypass run_once to test the handler; or temporarily resume,
    # enqueue, then run. Simpler: bypass via direct handler call.
    cmd = enqueue("set_mode", payload={"mode": "running"})
    HANDLERS["set_mode"](cmd)
    assert system_state.is_system_paused() is False


def test_pause_repo_then_resume_repo() -> None:
    init_db()
    cmd = enqueue("pause_repo", repo_id="alpha")
    res = run_once()
    assert res.handled
    assert res.status == "succeeded"
    assert system_state.is_repo_paused("alpha") is True

    enqueue("resume_repo", repo_id="alpha")
    run_once()
    assert system_state.is_repo_paused("alpha") is False


def test_stop_task_cancels_open_task() -> None:
    _seed_demo()
    t = create_task("demo", "x")
    enqueue("stop_task", task_id=t.id)
    res = run_once()
    assert res.handled
    fetched = get_task(t.id)
    assert fetched.status == "cancelled"


def test_stop_task_noop_for_already_terminal() -> None:
    _seed_demo()
    t = create_task("demo", "x")
    # Walk to merged terminal
    from orchestrator.task_manager import transition
    for s in (TaskStatus.planning, TaskStatus.coding, TaskStatus.testing,
              TaskStatus.reviewing, TaskStatus.validating, TaskStatus.pr_created,
              TaskStatus.auto_merging, TaskStatus.merged):
        transition(t.id, s)
    enqueue("stop_task", task_id=t.id)
    run_once()
    # Still merged (no illegal transition)
    assert get_task(t.id).status == "merged"


def test_stop_all_pauses_active_and_sets_system_paused() -> None:
    _seed_demo()
    a = create_task("demo", "a")
    b = create_task("demo", "b")
    enqueue("stop_all")
    res = run_once()
    assert res.handled
    assert system_state.is_system_paused()
    assert get_task(a.id).status == "paused"
    assert get_task(b.id).status == "paused"


def test_explain_stuck_summary_shape() -> None:
    _seed_demo()
    t = create_task("demo", "go")
    from orchestrator.task_manager import transition
    transition(t.id, TaskStatus.planning, message="started")
    transition(t.id, TaskStatus.stuck, message="model timeout")
    cmd = enqueue("explain_stuck", task_id=t.id)
    res = run_once()
    assert res.handled and res.status == "succeeded"
    result = res.result
    assert result["status"] == "stuck"
    assert "claude247 replay" in " ".join(result["safe_commands"])
    assert result["last_event"]["type"] == "stuck"


def test_approve_merge_updates_pr_and_writes_decision() -> None:
    _seed_demo()
    t = create_task("demo", "x")
    now = utc_now_iso()
    pid = make_id("pr")
    with open_db() as conn:
        conn.execute(
            "INSERT INTO prs (id, repo_id, task_id, pr_number, branch, title, url, "
            "state, approval_state, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (pid, "demo", t.id, 9, "agent/demo/x/y", "test", "u", "open",
             "required", now, now),
        )
    enqueue("approve_merge", repo_id="demo", pr_number=9)
    res = run_once()
    assert res.handled and res.status == "succeeded"
    with open_db() as conn:
        row = conn.execute("SELECT approval_state FROM prs WHERE id = ?",
                           (pid,)).fetchone()
        assert row["approval_state"] == "approved"
        dec = conn.execute("SELECT COUNT(*) AS c FROM decisions WHERE topic LIKE ?",
                           (f"PR #9 approval",)).fetchone()
        assert dec["c"] == 1


def test_reject_merge_updates_pr() -> None:
    _seed_demo()
    t = create_task("demo", "x")
    now = utc_now_iso()
    pid = make_id("pr")
    with open_db() as conn:
        conn.execute(
            "INSERT INTO prs (id, repo_id, task_id, pr_number, branch, title, url, "
            "state, approval_state, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (pid, "demo", t.id, 5, "br", "t", "u", "open", "required", now, now),
        )
    enqueue("reject_merge", repo_id="demo", pr_number=5,
             payload={"reason": "no thanks"})
    res = run_once()
    assert res.handled
    with open_db() as conn:
        row = conn.execute("SELECT approval_state FROM prs WHERE id = ?",
                            (pid,)).fetchone()
        assert row["approval_state"] == "rejected"


def test_approve_command_flips_status_to_queued() -> None:
    init_db()
    target = enqueue("set_mode", payload={"mode": "running"},
                      requires_approval=True)
    assert target.status == "requires_approval"
    approver = enqueue("approve_command", payload={"command_id": target.id})
    res = run_once()
    assert res.handled and res.status == "succeeded"
    assert get_command(target.id).status == "queued"


def test_reject_command_flips_status_to_rejected() -> None:
    init_db()
    target = enqueue("set_mode", payload={"mode": "running"},
                      requires_approval=True)
    enqueue("reject_command", payload={"command_id": target.id, "reason": "nope"})
    run_once()
    assert get_command(target.id).status == "rejected"


def test_start_task_uses_mock_runner_and_records_validation() -> None:
    """End-to-end with mocked runner + mock validator outcome."""
    _seed_demo()

    from validator.judge_contract import normalize_response
    from validator.validation_policy import ValidationOutcome

    captured_notifies: list = []

    def fake_notify(*, event, message, **kw):
        captured_notifies.append(event)
        return None

    # A fake runner that just claims a workspace dir and writes minimal evidence.
    class FakeRunner:
        backend = "local"

        def prepare_workspace(self, *, task_id, repo_id, goal):
            ws = Path(os.environ["CLAUDE247_WORKSPACE_ROOT"]) / task_id
            ws.mkdir(parents=True, exist_ok=True)
            # Pretend git
            (ws / ".git").mkdir(exist_ok=True)
            ev = ws / ".evidence"
            ev.mkdir(exist_ok=True)
            (ev / "contract.md").write_text("# c\nDeliver feature.\n")
            (ev / "diff_summary.md").write_text("# diff\n")
            (ev / "file_manifest.json").write_text("[]")
            (ev / "test_results.json").write_text(
                '[{"cmd":"pytest","exit":0,"stdout_tail":"","stderr_tail":"","duration_s":0.1}]'
            )
            (ev / "lint_results.json").write_text("[]")
            (ev / "build_results.json").write_text("[]")
            class _Prep:
                workspace = ws
                branch = f"agent/{repo_id}/{task_id}/g"
                repo_id_ = repo_id
                task_id_ = task_id
                used_existing = False
            return _Prep

        def get_repo(self, repo_id):
            from orchestrator.repo_registry import load_registry
            return [r for r in load_registry() if r.id == repo_id][0]

        def build_task_spec(self, **kw):
            return {"task_id": kw["task_id"]}

        def run(self, *, prep, spec, allow_roles=False):
            class _Outcome:
                exit_code = 0
                stderr = ""
                stdout = ""
                branch = prep.branch
                workspace = prep.workspace
            return _Outcome

    def fake_validator(inp):
        r = normalize_response("mock", {
            "verdict": "PASS", "confidence": 0.9, "summary": "ok",
            "blocking_issues": [], "non_blocking_issues": [],
            "evidence_gaps": [], "recommended_next_action": "merge",
        })
        return ValidationOutcome(
            ok_for_auto_merge=True, needs_human=False,
            final_verdict="PASS", results=[r, r],
            reasons=["all PASS"],
        )

    enqueue("start_task", repo_id="demo",
            payload={"repo_id": "demo", "goal": "do a thing"})
    res = run_once(runner=FakeRunner(), validator_fn=fake_validator,
                   notify_fn=fake_notify)
    assert res.handled and res.status == "succeeded", res.result
    assert res.result["risk_level"] == "low"
    # ruling -> waiting_for_approval (allow_remote_writes is False by default)
    assert res.result["ruling"]["decision"] == "waiting_approval"
    # validators recorded in DB
    with open_db() as conn:
        n = conn.execute("SELECT COUNT(*) AS c FROM validator_results").fetchone()["c"]
        assert n == 2
        rs = conn.execute("SELECT COUNT(*) AS c FROM risk_scores").fetchone()["c"]
        assert rs == 1
    # task_started + approval_required notifications fired
    assert "task_started" in captured_notifies
    assert "approval_required" in captured_notifies


def test_start_task_deferred_when_repo_paused() -> None:
    _seed_demo()
    system_state.pause_repo("demo")
    enqueue("start_task", repo_id="demo",
            payload={"repo_id": "demo", "goal": "x"})
    res = run_once()
    assert res.handled
    assert res.result.get("deferred") is True
    assert "paused" in res.result["reason"]


def test_start_task_missing_repo_returns_error() -> None:
    init_db()
    enqueue("start_task", repo_id="ghost",
            payload={"repo_id": "ghost", "goal": "x"})
    res = run_once()
    assert res.handled
    assert "unknown repo" in (res.result.get("error") or "")


def test_run_loop_processes_multiple_commands() -> None:
    init_db()
    from orchestrator.dispatcher import run_loop
    enqueue("pause_repo", repo_id="alpha")
    enqueue("pause_repo", repo_id="beta")
    enqueue("resume_repo", repo_id="alpha")
    results = run_loop(interval_seconds=0, max_iterations=5)
    handled = [r for r in results if r.handled]
    assert len(handled) == 3
    # alpha is now resumed, beta still paused
    assert system_state.is_repo_paused("alpha") is False
    assert system_state.is_repo_paused("beta") is True
