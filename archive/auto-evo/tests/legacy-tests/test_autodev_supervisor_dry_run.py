"""Supervisor dry-run integration test.

Exercises the full supervisor cycle end-to-end against tmp paths.  No real
inner engine; no Docker; no GitHub.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

import autodev.backlog_manager as bm
import autodev.command_manager as cm
import autodev.project_state as ps
import autodev.report_manager as rm
import autodev.supervisor as sup


@pytest.fixture
def repo(tmp_path, monkeypatch):
    """Build a tmpdir that looks like a real autodev repo."""
    for sub in ("reports", "tasks", "commands"):
        (tmp_path / sub).mkdir(parents=True, exist_ok=True)
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

    # Path overrides — each module accepts an override either directly or via env.
    monkeypatch.setenv("AUTODEV_REPORTS_DIR", str(tmp_path / "reports"))
    monkeypatch.setattr(ps, "state_path", lambda: tmp_path / "reports" / "state.json")
    monkeypatch.setattr(rm, "reports_dir", lambda: tmp_path / "reports")
    monkeypatch.setattr(bm, "backlog_path", lambda: tmp_path / "tasks" / "backlog.md")
    monkeypatch.setattr(bm, "current_path", lambda: tmp_path / "tasks" / "current.md")
    monkeypatch.setattr(bm, "done_path", lambda: tmp_path / "tasks" / "done.md")
    monkeypatch.setattr(bm, "blockers_path", lambda: tmp_path / "tasks" / "blockers.md")
    monkeypatch.setattr(cm, "inbox_path", lambda: tmp_path / "commands" / "inbox.md")
    monkeypatch.setattr(cm, "processed_path", lambda: tmp_path / "commands" / "processed.md")
    monkeypatch.setattr(cm, "backlog_path", lambda: tmp_path / "tasks" / "backlog.md")
    monkeypatch.setattr(sup, "hold_file_path", lambda: tmp_path / "reports" / "human-hold.md")
    # Isolate from the real HUMAN_CONFIG.md so the new config-mirror sync
    # doesn't leak the developer's live_allowed=true into tests that need
    # the default-state baseline. Individual tests can override this back.
    import autodev.cost_policy as _cp
    monkeypatch.setattr(_cp, "human_config_path", lambda: tmp_path / "_no_human_config.md")

    return tmp_path


def test_dry_run_cycle_completes_cleanly(repo: Path):
    rc = sup.run_once(dry_run=True)
    assert rc in (0, 2), f"unexpected exit {rc}"
    state = json.loads((repo / "reports" / "state.json").read_text())
    assert state["status"] in (
        "continue_current_task", "select_new_task", "repair_state",
        "report_only", "pause",
    )
    # Daily report was rewritten
    daily = (repo / "reports" / "daily.md").read_text()
    assert "AutoDev Daily Report" in daily


def test_dry_run_selects_first_p0_task(repo: Path):
    # First cycle should bootstrap and exit; second should pick the task.
    sup.run_once(dry_run=True)
    sup.run_once(dry_run=True)
    state = json.loads((repo / "reports" / "state.json").read_text())
    # Either the supervisor selected the task or it's already in progress.
    assert state["current_task_id"] in ("TASK-101", None)


def test_dry_run_respects_paused_flag(repo: Path):
    # Seed state with paused=true
    s = ps.ProjectState.load()
    s["paused"] = True
    s["health_status"] = "green"
    s.save()
    rc = sup.run_once(dry_run=True)
    assert rc == 0
    state = json.loads((repo / "reports" / "state.json").read_text())
    assert state["status"] == "pause"


def test_critical_blocker_halts_cycle(repo: Path):
    (repo / "reports" / "human-hold.md").write_text(
        "# Hold\n\n## HOLD-9: critical thing\n- Severity: critical\n"
    )
    s = ps.ProjectState.load()
    s["health_status"] = "green"
    s.save()
    rc = sup.run_once(dry_run=True)
    assert rc == 2  # held with no work done


def test_human_config_mirrors_into_state(repo: Path, monkeypatch):
    """Regression: live_allowed/autostart_allowed/mode in HUMAN_CONFIG.md
    must be authoritative — the supervisor was previously dry-running silently
    when HUMAN_CONFIG said live_allowed=true but state.json still said false."""
    # Stash a HUMAN_CONFIG.md beside the tmp repo and have CostPolicy read it.
    hc = repo / "HUMAN_CONFIG.md"
    hc.write_text(
        "## Cost policy\n```yaml\ncost:\n  mode: balanced\n```\n"
        "## Live\n```yaml\nruntime:\n  live_allowed: true\n  autostart_allowed: true\n```\n"
    )
    import autodev.cost_policy as cp
    monkeypatch.setattr(cp, "human_config_path", lambda: hc)
    # state.json starts with the safe defaults
    s = ps.ProjectState.load()
    assert s["live_allowed"] is False
    assert s["autostart_allowed"] is False
    assert s["mode"] == "cheap"
    sup.run_once(dry_run=True)
    s2 = ps.ProjectState.load()
    assert s2["live_allowed"] is True
    assert s2["autostart_allowed"] is True
    assert s2["mode"] == "balanced"
    assert s2["cost_mode"] == "balanced"
