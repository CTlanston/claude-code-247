from __future__ import annotations

import os
from pathlib import Path

import yaml
from fastapi.testclient import TestClient

from dashboard.app import create_app


def test_healthz() -> None:
    client = TestClient(create_app())
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_home_renders_when_db_empty() -> None:
    client = TestClient(create_app())
    r = client.get("/")
    assert r.status_code == 200, r.text
    assert "claude-code-247" in r.text
    assert "Auth mode" in r.text


def test_repos_page_shows_empty_state() -> None:
    client = TestClient(create_app())
    r = client.get("/repos")
    assert r.status_code == 200, r.text
    assert "No repos registered yet" in r.text


def test_repos_page_lists_after_registration(tmp_path: Path) -> None:
    repos_path = Path(os.environ["CLAUDE247_REPOS_FILE"])
    repos_path.write_text(yaml.safe_dump({"repos": [
        {"id": "demo", "github_owner": "owner", "github_repo": "demo-repo",
         "local_path": str(tmp_path), "forbidden_paths": [".env"]}
    ]}))
    client = TestClient(create_app())
    r = client.get("/repos")
    assert r.status_code == 200
    assert "demo" in r.text
    assert "owner/demo-repo" in r.text


def test_tasks_page_empty_state() -> None:
    client = TestClient(create_app())
    r = client.get("/tasks")
    assert r.status_code == 200
    assert "No tasks yet" in r.text
