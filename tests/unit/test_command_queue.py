from __future__ import annotations

import pytest

from memory.db import init_db
from orchestrator.command_queue import (
    CommandStatus,
    claim_next,
    complete,
    enqueue,
    get_command,
    list_commands,
)


def test_enqueue_rejects_unknown_command_type() -> None:
    init_db()
    with pytest.raises(ValueError):
        enqueue("not_a_real_command")


def test_enqueue_default_status_is_queued() -> None:
    init_db()
    c = enqueue("start_task", repo_id="demo", payload={"goal": "x"})
    assert c.status == "queued"
    assert c.created_by  # non-empty


def test_requires_approval_status() -> None:
    init_db()
    c = enqueue("approve_merge", repo_id="demo", pr_number=42, requires_approval=True)
    assert c.status == "requires_approval"


def test_claim_next_returns_oldest_queued() -> None:
    init_db()
    a = enqueue("start_task", repo_id="demo", payload={"g": "a"})
    enqueue("start_task", repo_id="demo", payload={"g": "b"})
    claimed = claim_next()
    assert claimed is not None
    assert claimed.id == a.id
    assert claimed.status == "running"


def test_claim_next_filters_by_type() -> None:
    init_db()
    enqueue("start_task", repo_id="r")
    p = enqueue("pause_repo", repo_id="r")
    claimed = claim_next(types=["pause_repo"])
    assert claimed is not None
    assert claimed.id == p.id


def test_complete_sets_terminal_status_and_result() -> None:
    init_db()
    c = enqueue("explain_stuck", task_id="task_abc", payload={})
    c2 = complete(c.id, CommandStatus.succeeded, result={"summary": "ok"})
    assert c2.status == "succeeded"
    assert c2.result == {"summary": "ok"}
    assert c2.finished_at is not None


def test_complete_rejects_non_terminal_status() -> None:
    init_db()
    c = enqueue("stop_all")
    with pytest.raises(ValueError):
        complete(c.id, CommandStatus.running)


def test_list_commands_filters_by_status() -> None:
    init_db()
    a = enqueue("start_task", repo_id="r", payload={"g": "a"})
    b = enqueue("start_task", repo_id="r", payload={"g": "b"})
    complete(b.id, CommandStatus.succeeded, result={"ok": True})
    queued = list_commands(status="queued")
    assert [c.id for c in queued] == [a.id]


def test_get_command_round_trip() -> None:
    init_db()
    c = enqueue("stop_all")
    assert get_command(c.id) is not None
    assert get_command("cmd_nonexistent") is None
