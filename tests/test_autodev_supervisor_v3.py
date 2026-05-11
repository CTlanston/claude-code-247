"""Regression tests for the two supervisor defects surfaced by V1 E2E.

Defect #2: SELECT_NEW returned "no work in backlog" without invoking the
inner engine, even when the inner engine's SQLite tasks table had pending
rows. V1 symptom: iters 2-8 spawned zero containers despite GitHub work.

Defect #3: `state.blocked` and `state.blocker_reason` were set on failure
but never cleared on subsequent success. V1 symptom: stale `exit 4`
blocker persisted across successful cycles.

Both tests construct a tmp-path repo (via the `repo` fixture from
test_autodev_supervisor_dry_run.py) and monkey-patch the inner engine so
no real subprocess / Docker / API calls happen.
"""
from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

import autodev.backlog_manager as bm
import autodev.command_manager as cm
import autodev.project_state as ps
import autodev.report_manager as rm
import autodev.supervisor as sup
from autodev.inner_engine import EngineResult


# --- shared fixture --------------------------------------------------------


@pytest.fixture
def repo(tmp_path, monkeypatch):
    """Mirror of the fixture in test_autodev_supervisor_dry_run.py — tmp repo
    that looks like a real autodev tree."""
    for sub in ("reports", "tasks", "commands"):
        (tmp_path / sub).mkdir(parents=True, exist_ok=True)
    # backlog with ONE queued task (so the first cycle has work) — tests
    # override this when they need an empty backlog.
    (tmp_path / "tasks" / "backlog.md").write_text(
        "# Backlog\n\n## P0\n\n- [ ] TASK-101: dry-run task :: details\n"
    )
    (tmp_path / "tasks" / "current.md").write_text("# Current\n\nNo task.\n")
    (tmp_path / "tasks" / "done.md").write_text("# Done\n")
    (tmp_path / "tasks" / "blockers.md").write_text("# Blockers\n")
    (tmp_path / "commands" / "inbox.md").write_text("")
    (tmp_path / "commands" / "processed.md").write_text("# Processed\n\n")
    (tmp_path / "reports" / "human-hold.md").write_text("# Hold\n\n")
    (tmp_path / "reports" / "session-log.md").write_text("# Log\n")
    (tmp_path / "reports" / "run-history.md").write_text("# History\n")
    (tmp_path / "reports" / "decisions.md").write_text("# Decisions\n")

    # Isolate paths
    monkeypatch.setenv("AUTODEV_REPORTS_DIR", str(tmp_path / "reports"))
    monkeypatch.setattr(ps, "state_path",     lambda: tmp_path / "reports" / "state.json")
    monkeypatch.setattr(rm, "reports_dir",    lambda: tmp_path / "reports")
    monkeypatch.setattr(bm, "backlog_path",   lambda: tmp_path / "tasks" / "backlog.md")
    monkeypatch.setattr(bm, "current_path",   lambda: tmp_path / "tasks" / "current.md")
    monkeypatch.setattr(bm, "done_path",      lambda: tmp_path / "tasks" / "done.md")
    monkeypatch.setattr(bm, "blockers_path",  lambda: tmp_path / "tasks" / "blockers.md")
    monkeypatch.setattr(cm, "inbox_path",     lambda: tmp_path / "commands" / "inbox.md")
    monkeypatch.setattr(cm, "processed_path", lambda: tmp_path / "commands" / "processed.md")
    monkeypatch.setattr(cm, "backlog_path",   lambda: tmp_path / "tasks" / "backlog.md")
    monkeypatch.setattr(sup, "hold_file_path", lambda: tmp_path / "reports" / "human-hold.md")
    # Isolate from real HUMAN_CONFIG.md so the supervisor's config-mirror sync
    # doesn't leak the developer's live_allowed=true into tests that need
    # the default-state baseline.
    import autodev.cost_policy as _cp
    monkeypatch.setattr(_cp, "human_config_path", lambda: tmp_path / "_no_human_config.md")

    return tmp_path


# --- Defect #2: SELECT_NEW must check inner engine when backlog empty -------


def test_select_new_short_circuit_when_inner_has_pending_work(repo, monkeypatch):
    """When local backlog has no queued bullets AND the inner engine has at
    least one pending task row, the supervisor MUST still call the inner
    engine (via a synthetic task) — not return "no work in backlog"."""
    # Empty backlog: all tasks already in_progress
    (repo / "tasks" / "backlog.md").write_text(
        "# Backlog\n\n## P0\n\n- [.] TASK-101: in progress :: details\n"
    )
    # state: live_allowed=true, blocked=false, healthy
    state = ps.ProjectState.load()
    state["live_allowed"] = True
    state["health_status"] = "green"
    state.save()

    # Inner-engine sentinel: pretend SQLite has pending work
    monkeypatch.setattr(
        sup, "_inner_engine_has_pending_work", lambda: True
    )

    # Spy on InnerEngine.run_task — we capture whether it was called and skip
    # the actual subprocess invocation.
    called = {"count": 0, "tasks": []}

    def fake_run_task(self, task, _state):
        called["count"] += 1
        called["tasks"].append(task)
        return EngineResult(success=True, duration_seconds=0.1,
                            extra={"synthetic_call": True})

    monkeypatch.setattr(
        "autodev.inner_engine.InnerEngine.run_task", fake_run_task,
        raising=True,
    )

    # Run one cycle (dry-run forces live=False inside InnerEngine; we still
    # expect the supervisor to invoke run_task, which is what we're testing
    # at the supervisor layer, not the engine).
    rc = sup.run_once(dry_run=False)
    assert called["count"] == 1, (
        f"expected inner engine to be called once via synthetic task; got {called['count']}"
    )
    task = called["tasks"][0]
    # The synthetic task should signal it's a tick, not a real backlog item
    assert task.task_id.startswith("TASK-INNER-") or task.task_id.startswith("TASK-TICK-"), \
        f"expected synthetic task id, got {task.task_id!r}"
    assert rc == 0


def test_select_new_genuinely_no_work_still_short_circuits(repo, monkeypatch):
    """If backlog has no queued tasks AND inner engine also has no pending
    work, the original early return ("no work in backlog") must still fire —
    we don't want to invoke the engine on truly empty input."""
    (repo / "tasks" / "backlog.md").write_text(
        "# Backlog\n\n## P0\n\n"  # no `- [ ]` bullets at all
    )
    state = ps.ProjectState.load()
    state["live_allowed"] = True
    state["health_status"] = "green"
    state.save()

    monkeypatch.setattr(
        sup, "_inner_engine_has_pending_work", lambda: False
    )

    called = {"count": 0}

    def fake_run_task(self, task, _state):
        called["count"] += 1
        return EngineResult(success=True)

    monkeypatch.setattr(
        "autodev.inner_engine.InnerEngine.run_task", fake_run_task,
        raising=True,
    )

    rc = sup.run_once(dry_run=False)
    assert called["count"] == 0, "engine called even though nothing was pending"
    assert rc == 0


# --- Defect #3: state.blocked must clear on successful cycle ----------------


def test_blocked_state_clears_on_successful_cycle(repo, monkeypatch):
    """If a prior cycle left state.blocked=True with a stale blocker_reason,
    a subsequent successful cycle must reset both."""
    state = ps.ProjectState.load()
    state["blocked"] = True
    state["blocker_reason"] = "inner engine exit 4"
    state["health_status"] = "warn"
    state["live_allowed"] = True
    state["repair_attempts_for_current_task"] = 2
    state.save()

    # Stub inner engine to clean success
    def fake_run_task(self, task, _state):
        return EngineResult(success=True, duration_seconds=0.1)
    monkeypatch.setattr(
        "autodev.inner_engine.InnerEngine.run_task", fake_run_task,
        raising=True,
    )

    sup.run_once(dry_run=False)

    after = ps.ProjectState.load()
    assert after["blocked"] is False, "blocked should clear on success"
    assert after["blocker_reason"] is None, \
        f"blocker_reason should clear; got {after['blocker_reason']!r}"
    assert after["repair_attempts_for_current_task"] == 0, \
        "repair_attempts should reset on success"


def test_blocked_state_stays_set_on_failed_cycle(repo, monkeypatch):
    """When the inner engine fails (blocked=True returned), state.blocked
    must remain True and blocker_reason must reflect the new failure
    (not stick to the old one)."""
    state = ps.ProjectState.load()
    state["blocked"] = True
    state["blocker_reason"] = "stale reason from yesterday"
    state["live_allowed"] = True
    state["health_status"] = "warn"   # skip REPAIR_STATE → reach SELECT_NEW
    state.save()

    def fake_run_task(self, task, _state):
        return EngineResult(success=False, blocked=True,
                            blocker_reason="fresh failure",
                            duration_seconds=0.1)
    monkeypatch.setattr(
        "autodev.inner_engine.InnerEngine.run_task", fake_run_task,
        raising=True,
    )

    sup.run_once(dry_run=False)

    after = ps.ProjectState.load()
    assert after["blocked"] is True
    assert after["blocker_reason"] == "fresh failure", \
        f"blocker_reason should refresh; got {after['blocker_reason']!r}"
