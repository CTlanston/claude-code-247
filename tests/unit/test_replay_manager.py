from __future__ import annotations

import json
import os
from pathlib import Path

import pytest
import yaml

from memory.db import init_db, open_db
from orchestrator.ids import make_id, utc_now_iso
from orchestrator.replay_manager import build_replay_package, explain
from orchestrator.repo_registry import parse_registry, sync_to_db


def _seed_repo(fake_repo: Path) -> None:
    repos_path = Path(os.environ["CLAUDE247_REPOS_FILE"])
    repos_path.write_text(yaml.safe_dump({"repos": [{
        "id": "demo", "github_owner": "o", "github_repo": "r",
        "local_path": str(fake_repo), "forbidden_paths": [".env"],
    }]}))
    init_db()
    sync_to_db(parse_registry(repos_path.read_text()))


def _seed_task(*, repo_id: str = "demo", status: str = "failed") -> str:
    now = utc_now_iso()
    tid = make_id("task")
    with open_db() as conn:
        conn.execute(
            "INSERT INTO tasks (id, repo_id, goal, source, status, created_at, "
            "updated_at, payload_json) VALUES (?,?,?,?,?,?,?,?)",
            (tid, repo_id, "do thing", "cli", status, now, now, "{}"),
        )
        conn.execute(
            "INSERT INTO task_events (id, task_id, created_at, event_type, message) "
            "VALUES (?,?,?,?,?)",
            (make_id("evt"), tid, now, "created", "created from cli"),
        )
        conn.execute(
            "INSERT INTO task_events (id, task_id, created_at, event_type, message) "
            "VALUES (?,?,?,?,?)",
            (make_id("evt"), tid, now, "failed", "tests blew up"),
        )
    return tid


def test_unknown_task_raises() -> None:
    init_db()
    with pytest.raises(ValueError):
        build_replay_package("task_nonexistent")


def test_build_package_includes_task_events_environment(fake_repo: Path) -> None:
    _seed_repo(fake_repo)
    tid = _seed_task()
    pkg = build_replay_package(tid)
    assert pkg.path.exists()
    body = json.loads(pkg.path.read_text())
    assert body["task"]["id"] == tid
    assert len(body["events"]) >= 2
    assert "environment" in body
    assert "python" in body["environment"]
    assert "repo_snapshot" in body
    assert body["repo_snapshot"]["id"] == "demo"


def test_explain_summary_contains_key_facts(fake_repo: Path) -> None:
    _seed_repo(fake_repo)
    tid = _seed_task()
    pkg = build_replay_package(tid)
    text = explain(pkg)
    assert tid in text
    assert "demo" in text
    assert "do thing" in text


def test_build_package_handles_missing_workspace_gracefully(fake_repo: Path) -> None:
    _seed_repo(fake_repo)
    tid = _seed_task()
    pkg = build_replay_package(tid)
    # workspace might or might not exist; either way, build should succeed
    assert pkg.path.exists()
