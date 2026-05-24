"""ReportManager tests."""
from __future__ import annotations

import json
from pathlib import Path

from autodev.project_state import ProjectState
from autodev.report_manager import ReportManager


def _setup(tmp_path: Path, monkeypatch):
    import autodev.report_manager as rm
    monkeypatch.setattr(rm, "reports_dir", lambda: tmp_path)
    (tmp_path / "session-log.md").write_text("# log\n")
    (tmp_path / "run-history.md").write_text("# run history\n")


def test_cycle_finished_writes_all_artifacts(tmp_path: Path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    s = ProjectState()
    s["current_task_id"] = "TASK-001"
    s["cost_mode"] = "cheap"
    rm = ReportManager(s)
    rm.cycle_finished(summary="ok", success=True, task_id="TASK-001", notes="x")

    daily = (tmp_path / "daily.md").read_text()
    heart = json.loads((tmp_path / "heartbeat.json").read_text())
    sess = (tmp_path / "session-log.md").read_text()
    runhist = (tmp_path / "run-history.md").read_text()

    assert "AutoDev Daily Report" in daily
    assert "TASK-001" in daily
    assert heart["cycles_completed"] == 1
    assert "cycle.ok" in sess
    assert "ok" in runhist


def test_two_cycles_increment_counter(tmp_path: Path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    s = ProjectState()
    rm = ReportManager(s)
    rm.cycle_finished(summary="a", success=True, task_id=None)
    rm.cycle_finished(summary="b", success=True, task_id=None)
    heart = json.loads((tmp_path / "heartbeat.json").read_text())
    assert heart["cycles_completed"] == 2


def test_warn_status_when_unsuccessful(tmp_path: Path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    rm = ReportManager(ProjectState())
    rm.cycle_finished(summary="failed", success=False, task_id=None)
    sess = (tmp_path / "session-log.md").read_text()
    assert "cycle.warn" in sess
