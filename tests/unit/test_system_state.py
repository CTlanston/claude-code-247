from __future__ import annotations

from memory.db import init_db
from orchestrator import system_state


def test_system_pause_default_false() -> None:
    init_db()
    assert system_state.is_system_paused() is False


def test_pause_then_resume_system() -> None:
    init_db()
    system_state.pause_system()
    assert system_state.is_system_paused() is True
    system_state.resume_system()
    assert system_state.is_system_paused() is False


def test_repo_pause_isolated_by_id() -> None:
    init_db()
    system_state.pause_repo("alpha")
    assert system_state.is_repo_paused("alpha") is True
    assert system_state.is_repo_paused("beta") is False
    system_state.resume_repo("alpha")
    assert system_state.is_repo_paused("alpha") is False


def test_snapshot_returns_all_flags() -> None:
    init_db()
    system_state.pause_system()
    system_state.pause_repo("alpha")
    snap = system_state.snapshot()
    assert snap.get("system.paused") == "1"
    assert snap.get("repo.paused.alpha") == "1"
