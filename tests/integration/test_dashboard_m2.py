from __future__ import annotations

import os
from pathlib import Path

import yaml
from fastapi.testclient import TestClient

from dashboard.app import create_app
from memory.db import init_db
from orchestrator.command_queue import list_commands
from orchestrator.repo_registry import parse_registry, sync_to_db
from orchestrator.task_manager import TaskStatus, create_task, transition


def _seed_demo() -> None:
    repos_path = Path(os.environ["CLAUDE247_REPOS_FILE"])
    repos_path.write_text(yaml.safe_dump({"repos": [
        {"id": "demo", "github_owner": "o", "github_repo": "r",
         "local_path": "/tmp/demo", "forbidden_paths": [".env"]}
    ]}))
    init_db()
    sync_to_db(parse_registry(repos_path.read_text()))


def test_onboarding_get_renders_form() -> None:
    client = TestClient(create_app())
    r = client.get("/onboarding")
    assert r.status_code == 200
    assert "Repo id" in r.text


def test_onboarding_post_invalid_shows_errors() -> None:
    client = TestClient(create_app())
    r = client.post("/onboarding", data={
        "repo_id": "", "github_owner": "", "github_repo": "",
        "local_path": "", "default_branch": "main",
        "forbidden_paths": ".env",
    })
    # we render the form back with errors (status 200, no redirect)
    assert r.status_code == 200
    assert "missing required field" in r.text


def test_onboarding_post_valid_redirects(tmp_path: Path) -> None:
    client = TestClient(create_app())
    r = client.post("/onboarding", data={
        "repo_id": "wizard",
        "github_owner": "o",
        "github_repo": "wizard-repo",
        "local_path": str(tmp_path),
        "default_branch": "main",
        "forbidden_paths": ".env,.env.*",
        # probe disabled
        "probe_local": "off",
    }, follow_redirects=False)
    assert r.status_code == 303
    assert r.headers["location"] == "/repos"


def test_task_detail_page_404_for_unknown() -> None:
    client = TestClient(create_app())
    r = client.get("/tasks/task_does_not_exist")
    assert r.status_code == 404


def test_task_detail_page_renders_timeline() -> None:
    _seed_demo()
    t = create_task("demo", "page goal")
    transition(t.id, TaskStatus.planning, message="started planning")
    client = TestClient(create_app())
    r = client.get(f"/tasks/{t.id}")
    assert r.status_code == 200
    assert "page goal" in r.text
    assert "started planning" in r.text


def test_post_tasks_start_enqueues_command() -> None:
    _seed_demo()
    client = TestClient(create_app())
    r = client.post("/tasks/start", data={"repo_id": "demo", "goal": "from-dashboard"})
    assert r.status_code == 200
    cmds = list_commands()
    assert any(c.source == "dashboard" and c.command_type == "start_task" for c in cmds)


def test_commands_page_lists_entries() -> None:
    _seed_demo()
    client = TestClient(create_app())
    client.post("/tasks/start", data={"repo_id": "demo", "goal": "x"})
    r = client.get("/commands")
    assert r.status_code == 200
    assert "start_task" in r.text
