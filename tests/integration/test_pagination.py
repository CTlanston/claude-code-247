from __future__ import annotations

import os
from pathlib import Path

import yaml
from fastapi.testclient import TestClient

from dashboard.app import create_app
from memory.db import init_db
from orchestrator.command_queue import enqueue
from orchestrator.ids import make_id, utc_now_iso
from orchestrator.log_indexer import write as log_write
from orchestrator.repo_registry import parse_registry, sync_to_db
from orchestrator.task_manager import create_task


def _seed_repo() -> None:
    repos_path = Path(os.environ["CLAUDE247_REPOS_FILE"])
    repos_path.write_text(yaml.safe_dump({"repos": [{
        "id": "demo", "github_owner": "o", "github_repo": "r",
        "local_path": "/tmp/demo", "forbidden_paths": [".env"],
    }]}))
    init_db()
    sync_to_db(parse_registry(repos_path.read_text()))


def test_tasks_pagination_offset_advances() -> None:
    _seed_repo()
    for i in range(8):
        create_task("demo", f"goal-{i}")
    client = TestClient(create_app())
    # First page: 3 newest
    r = client.get("/tasks?limit=3&offset=0")
    assert r.status_code == 200
    assert "goal-7" in r.text and "goal-5" in r.text
    assert "goal-4" not in r.text
    assert "next →" in r.text
    # Second page
    r2 = client.get("/tasks?limit=3&offset=3")
    assert "goal-4" in r2.text and "goal-2" in r2.text
    assert "goal-7" not in r2.text
    assert "← prev" in r2.text


def test_commands_pagination_caps_limit() -> None:
    init_db()
    for i in range(5):
        enqueue("set_mode", payload={"mode": "running"})
    client = TestClient(create_app())
    r = client.get("/commands?limit=2&offset=0")
    assert r.text.count("set_mode") == 2


def test_logs_pagination_works() -> None:
    init_db()
    for i in range(6):
        log_write(level="info", component="t", message=f"msg-{i}")
    client = TestClient(create_app())
    r = client.get("/logs?limit=2&offset=0")
    assert "msg-5" in r.text and "msg-4" in r.text
    assert "msg-3" not in r.text


def test_invalid_pagination_clamped() -> None:
    init_db()
    client = TestClient(create_app())
    r = client.get("/tasks?limit=-5&offset=-100")
    assert r.status_code == 200  # clamped, not 422
