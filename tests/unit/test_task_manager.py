from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from memory.db import init_db
from orchestrator.repo_registry import parse_registry, sync_to_db
from orchestrator.task_manager import (
    InvalidTransitionError,
    TaskStatus,
    create_task,
    get_task,
    get_timeline,
    list_tasks,
    transition,
)


def _seed_repo() -> None:
    init_db()
    entries = parse_registry(yaml.safe_dump({"repos": [
        {"id": "demo", "github_owner": "o", "github_repo": "r",
         "local_path": "/tmp/demo", "forbidden_paths": [".env"]}
    ]}))
    sync_to_db(entries)


def test_create_task_requires_known_repo() -> None:
    init_db()
    with pytest.raises(ValueError):
        create_task("nonexistent", "do the thing")


def test_create_task_requires_goal() -> None:
    _seed_repo()
    with pytest.raises(ValueError):
        create_task("demo", "   ")


def test_create_task_records_initial_event() -> None:
    _seed_repo()
    t = create_task("demo", "first task")
    assert t.status == "queued"
    events = get_timeline(t.id)
    assert len(events) == 1
    assert events[0]["event_type"] == "created"


def test_legal_transition_walks_to_terminal() -> None:
    _seed_repo()
    t = create_task("demo", "walking")
    chain = [
        TaskStatus.planning, TaskStatus.coding, TaskStatus.testing,
        TaskStatus.reviewing, TaskStatus.validating, TaskStatus.pr_created,
        TaskStatus.auto_merging, TaskStatus.merged,
    ]
    for status in chain:
        t = transition(t.id, status, message=f"-> {status.value}")
    assert t.status == "merged"
    assert t.finished_at is not None
    events = get_timeline(t.id)
    # 1 created + 8 transitions
    assert len(events) == 9
    assert [e["event_type"] for e in events[1:]] == [s.value for s in chain]


def test_illegal_transition_raises() -> None:
    _seed_repo()
    t = create_task("demo", "x")
    with pytest.raises(InvalidTransitionError):
        transition(t.id, TaskStatus.merged)


def test_list_tasks_filters_by_repo_and_status() -> None:
    _seed_repo()
    a = create_task("demo", "a")
    b = create_task("demo", "b")
    transition(b.id, TaskStatus.planning)
    all_q = list_tasks(status="queued")
    assert [t.id for t in all_q] == [a.id]
    by_repo = list_tasks(repo_id="demo")
    assert {t.id for t in by_repo} == {a.id, b.id}


def test_pause_then_resume_returns_to_prior_lane() -> None:
    _seed_repo()
    t = create_task("demo", "p")
    transition(t.id, TaskStatus.planning)
    transition(t.id, TaskStatus.paused)
    t = transition(t.id, TaskStatus.coding)  # paused -> coding is allowed
    assert t.status == "coding"


def test_get_task_returns_none_for_missing() -> None:
    init_db()
    assert get_task("task_does_not_exist") is None
