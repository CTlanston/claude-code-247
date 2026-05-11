"""BacklogManager tests."""
from __future__ import annotations

from pathlib import Path

from autodev.backlog_manager import BacklogManager


def _write_backlog(p: Path, body: str) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(body)


def test_parses_simple_backlog(tmp_path: Path):
    b = tmp_path / "backlog.md"
    _write_backlog(
        b,
        "# Backlog\n\n"
        "## P0\n\n"
        "- [ ] TASK-001: title :: details one\n"
        "- [x] TASK-002: done one :: details two\n"
        "\n## P1\n\n"
        "- [ ] TASK-003: second :: details three\n",
    )
    tasks = BacklogManager(backlog_file=b).parse()
    assert [t.task_id for t in tasks] == ["TASK-001", "TASK-002", "TASK-003"]
    assert tasks[0].priority == "P0"
    assert tasks[2].priority == "P1"
    assert tasks[0].status == " "
    assert tasks[1].status == "x"


def test_next_unblocked_prefers_p0(tmp_path: Path):
    b = tmp_path / "backlog.md"
    _write_backlog(
        b,
        "# Backlog\n## P1\n- [ ] TASK-002: low :: l\n"
        "## P0\n- [ ] TASK-001: high :: h\n",
    )
    nxt = BacklogManager(backlog_file=b).next_unblocked()
    assert nxt is not None
    assert nxt.task_id == "TASK-001"


def test_next_unblocked_skips_done_and_blocked(tmp_path: Path):
    b = tmp_path / "backlog.md"
    _write_backlog(
        b,
        "# Backlog\n## P0\n"
        "- [x] TASK-001: done :: -\n"
        "- [!] TASK-002: blocked :: -\n"
        "- [.] TASK-003: in progress :: -\n"
        "- [ ] TASK-004: queued :: -\n",
    )
    nxt = BacklogManager(backlog_file=b).next_unblocked()
    assert nxt.task_id == "TASK-004"


def test_empty_backlog_returns_none(tmp_path: Path):
    b = tmp_path / "backlog.md"
    _write_backlog(b, "# Backlog\n\n## P0\n\n## P1\n")
    assert BacklogManager(backlog_file=b).next_unblocked() is None


def test_mark_in_progress_flips_brackets(tmp_path: Path):
    b = tmp_path / "backlog.md"
    _write_backlog(b, "# Backlog\n## P0\n- [ ] TASK-001: x :: y\n")
    mgr = BacklogManager(backlog_file=b)
    assert mgr.mark_in_progress("TASK-001") is True
    assert "[.]" in b.read_text()
    assert "[ ]" not in b.read_text().split("TASK-001")[0].splitlines()[-1]


def test_mark_done_archives_and_flips(tmp_path: Path, monkeypatch):
    b = tmp_path / "backlog.md"
    # Override done_path() / blockers_path() to live in tmp
    import autodev.backlog_manager as bm
    monkeypatch.setattr(bm, "done_path", lambda: tmp_path / "done.md")
    monkeypatch.setattr(bm, "blockers_path", lambda: tmp_path / "blockers.md")
    _write_backlog(b, "# Backlog\n## P0\n- [.] TASK-001: x :: y\n")
    mgr = BacklogManager(backlog_file=b)
    assert mgr.mark_done("TASK-001") is True
    assert "[x]" in b.read_text()
    assert (tmp_path / "done.md").exists()
    assert "TASK-001" in (tmp_path / "done.md").read_text()


def test_write_current_records_pickup(tmp_path: Path, monkeypatch):
    import autodev.backlog_manager as bm
    monkeypatch.setattr(bm, "current_path", lambda: tmp_path / "current.md")
    mgr = BacklogManager()
    task = bm.BacklogTask(
        task_id="TASK-007", title="t", details="d", priority="P0", status=" ",
    )
    mgr.write_current(task)
    text = (tmp_path / "current.md").read_text()
    assert "TASK-007" in text
    assert "P0" in text
