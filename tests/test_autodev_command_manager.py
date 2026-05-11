"""CommandManager tests."""
from __future__ import annotations

from pathlib import Path

from autodev.command_manager import CommandManager
from autodev.project_state import ProjectState


def _setup(tmp_path: Path, monkeypatch):
    """Re-route the path helpers to tmp."""
    import autodev.command_manager as cm
    monkeypatch.setattr(cm, "inbox_path", lambda: tmp_path / "inbox.md")
    monkeypatch.setattr(cm, "processed_path", lambda: tmp_path / "processed.md")
    monkeypatch.setattr(cm, "backlog_path", lambda: tmp_path / "backlog.md")
    (tmp_path / "inbox.md").write_text("")
    (tmp_path / "processed.md").write_text("# Processed\n\n")
    (tmp_path / "backlog.md").write_text("# Backlog\n\n## P0\n\n")


def test_pause_command_sets_state(tmp_path: Path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    (tmp_path / "inbox.md").write_text("/pause\n")
    s = ProjectState()
    results = CommandManager(s).process_inbox()
    assert any(r.outcome == "applied" and r.name == "/pause" for r in results)
    assert s["paused"] is True


def test_resume_command_clears_pause(tmp_path: Path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    (tmp_path / "inbox.md").write_text("/resume\n")
    s = ProjectState()
    s["paused"] = True
    CommandManager(s).process_inbox()
    assert s["paused"] is False


def test_set_mode_validates_value(tmp_path: Path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    (tmp_path / "inbox.md").write_text("/set-mode premium\n/set-mode bogus\n")
    s = ProjectState()
    results = CommandManager(s).process_inbox()
    by_args = {r.args: r for r in results}
    assert by_args["premium"].outcome == "applied"
    assert by_args["bogus"].outcome == "rejected"
    assert s["mode"] == "premium"


def test_new_task_appends_to_backlog(tmp_path: Path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    (tmp_path / "inbox.md").write_text(
        "/new-task P1 example task :: with extra details\n"
    )
    s = ProjectState()
    results = CommandManager(s).process_inbox()
    assert results[0].outcome == "applied"
    backlog = (tmp_path / "backlog.md").read_text()
    assert "example task" in backlog
    assert "with extra details" in backlog
    assert "TASK-001" in backlog or "TASK-" in backlog


def test_idempotency_does_not_double_apply(tmp_path: Path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    (tmp_path / "inbox.md").write_text("/pause\n")
    s = ProjectState()
    mgr = CommandManager(s)
    first = mgr.process_inbox()
    assert len(first) == 1
    # On a second pass the line is still in inbox.md but already processed.
    second = mgr.process_inbox()
    assert second == []


def test_malformed_line_rejected(tmp_path: Path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    (tmp_path / "inbox.md").write_text("/unknown-thing 42\n")
    s = ProjectState()
    results = CommandManager(s).process_inbox()
    assert results[0].outcome == "rejected"


def test_non_command_lines_ignored(tmp_path: Path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    (tmp_path / "inbox.md").write_text(
        "# Inbox\n\n## Pending\n\n(empty)\n\nsome free text\n"
    )
    s = ProjectState()
    results = CommandManager(s).process_inbox()
    assert results == []


def test_fenced_block_lines_are_inert(tmp_path: Path, monkeypatch):
    """Regression: the inbox template documents commands INSIDE a
    ``` fence. The parser must ignore those lines or it'd treat the docs
    as live commands."""
    _setup(tmp_path, monkeypatch)
    (tmp_path / "inbox.md").write_text(
        "# Inbox\n\nDocs:\n"
        "```\n"
        "/pause\n"
        "/resume\n"
        "/set-mode premium\n"
        "```\n"
        "\n## Pending\n\n(empty)\n"
    )
    s = ProjectState()
    results = CommandManager(s).process_inbox()
    assert results == []
    assert s["paused"] is False
    assert s["mode"] == "cheap"  # default unchanged


def test_real_command_after_fence_works(tmp_path: Path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    (tmp_path / "inbox.md").write_text(
        "```\n/pause\n```\n\n## Pending\n\n/resume\n"
    )
    s = ProjectState()
    s["paused"] = True
    results = CommandManager(s).process_inbox()
    assert len(results) == 1
    assert results[0].name == "/resume"
    assert s["paused"] is False


def test_set_mode_does_not_auto_grant_api_spend(tmp_path: Path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    (tmp_path / "inbox.md").write_text("/set-mode premium\n")
    s = ProjectState()
    assert s["api_spend_allowed"] is False
    CommandManager(s).process_inbox()
    assert s["mode"] == "premium"
    # Premium mode must NOT auto-grant — CostPolicy is the gate.
    assert s["api_spend_allowed"] is False
