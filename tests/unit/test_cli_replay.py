from __future__ import annotations

import json
import os
from pathlib import Path

import yaml
from click.testing import CliRunner

from gateway.cli import cli
from memory.db import init_db, open_db
from orchestrator.ids import make_id, utc_now_iso
from orchestrator.repo_registry import parse_registry, sync_to_db


def _seed(fake_repo: Path) -> str:
    repos_path = Path(os.environ["CLAUDE247_REPOS_FILE"])
    repos_path.write_text(yaml.safe_dump({"repos": [{
        "id": "demo", "github_owner": "o", "github_repo": "r",
        "local_path": str(fake_repo), "forbidden_paths": [".env"],
    }]}))
    init_db()
    sync_to_db(parse_registry(repos_path.read_text()))
    tid = make_id("task")
    now = utc_now_iso()
    with open_db() as conn:
        conn.execute("INSERT INTO tasks (id, repo_id, goal, source, status, "
                     "created_at, updated_at, payload_json) VALUES (?,?,?,?,?,?,?,?)",
                     (tid, "demo", "g", "cli", "failed", now, now, "{}"))
    return tid


def test_replay_default_writes_package(fake_repo: Path) -> None:
    tid = _seed(fake_repo)
    r = CliRunner().invoke(cli, ["replay", "--task", tid])
    assert r.exit_code == 0, r.output
    assert "replay package written" in r.output


def test_replay_explain_only(fake_repo: Path) -> None:
    tid = _seed(fake_repo)
    r = CliRunner().invoke(cli, ["replay", "--task", tid, "--explain-only"])
    assert r.exit_code == 0, r.output
    assert tid in r.output
    assert "demo" in r.output


def test_replay_json_shape(fake_repo: Path) -> None:
    tid = _seed(fake_repo)
    r = CliRunner().invoke(cli, ["replay", "--task", tid, "--json"])
    assert r.exit_code == 0
    payload = json.loads(r.output)
    assert "package_path" in payload
    assert payload["package"]["task"]["id"] == tid


def test_replay_mutually_exclusive_flags(fake_repo: Path) -> None:
    tid = _seed(fake_repo)
    r = CliRunner().invoke(cli, ["replay", "--task", tid, "--dry-run", "--repair"])
    assert r.exit_code != 0
