"""RecoveryManager tests."""
from __future__ import annotations

from pathlib import Path

from autodev.project_state import ProjectState
from autodev.recovery_manager import RecoveryAction, RecoveryManager


def _state(**overrides) -> ProjectState:
    s = ProjectState()
    for k, v in overrides.items():
        s[k] = v
    return s


def test_paused_state_returns_pause(tmp_path: Path):
    s = _state(paused=True, health_status="green")
    r = RecoveryManager(s).decide_next_action()
    assert r.action == RecoveryAction.PAUSE


def test_report_only_overrides_everything(tmp_path: Path):
    s = _state(paused=True, blocked=True, health_status="warn")
    r = RecoveryManager(s, report_only=True).decide_next_action()
    assert r.action == RecoveryAction.REPORT_ONLY


def test_critical_blocker_triggers_hold(tmp_path: Path):
    hold = tmp_path / "human-hold.md"
    hold.write_text(
        "# Human hold\n\n"
        "## HOLD-99: critical thing\n\n"
        "- Severity: critical\n- Category: safety\n"
    )
    s = _state(health_status="green")
    r = RecoveryManager(s, hold_file=hold).decide_next_action()
    assert r.action == RecoveryAction.HOLD_FOR_HUMAN
    assert "HOLD-99" in (r.detail or "")


def test_low_severity_hold_does_not_halt(tmp_path: Path):
    hold = tmp_path / "human-hold.md"
    hold.write_text(
        "# Human hold\n\n"
        "## HOLD-1: trivial\n\n"
        "- Severity: low\n- Category: product-decision\n"
    )
    s = _state(health_status="green")
    r = RecoveryManager(s, hold_file=hold).decide_next_action()
    assert r.action == RecoveryAction.SELECT_NEW


def test_bootstrap_health_triggers_repair(tmp_path: Path):
    s = _state(health_status="bootstrap")
    r = RecoveryManager(s).decide_next_action()
    assert r.action == RecoveryAction.REPAIR_STATE


def test_current_task_continues(tmp_path: Path):
    s = _state(
        health_status="green",
        current_task_id="TASK-001",
        current_task_title="x",
        blocked=False,
    )
    r = RecoveryManager(s).decide_next_action()
    assert r.action == RecoveryAction.CONTINUE_CURRENT


def test_blocked_current_task_does_not_continue(tmp_path: Path):
    s = _state(
        health_status="green",
        current_task_id="TASK-001",
        current_task_title="x",
        blocked=True,
    )
    r = RecoveryManager(s).decide_next_action()
    assert r.action == RecoveryAction.SELECT_NEW


def test_no_current_task_selects_new(tmp_path: Path):
    s = _state(health_status="green")
    r = RecoveryManager(s).decide_next_action()
    assert r.action == RecoveryAction.SELECT_NEW
