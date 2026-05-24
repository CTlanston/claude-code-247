from __future__ import annotations

import json
import os
from pathlib import Path

import yaml
from click.testing import CliRunner

from gateway.cli import cli
from memory.db import init_db
from orchestrator.command_queue import list_commands
from orchestrator.repo_registry import parse_registry, sync_to_db


def _seed_demo_repo() -> None:
    repos_path = Path(os.environ["CLAUDE247_REPOS_FILE"])
    repos_path.write_text(yaml.safe_dump({"repos": [
        {"id": "demo", "github_owner": "o", "github_repo": "r",
         "local_path": "/tmp/demo", "forbidden_paths": [".env"]}
    ]}))
    init_db()
    sync_to_db(parse_registry(repos_path.read_text()))


def test_start_enqueues_command() -> None:
    _seed_demo_repo()
    r = CliRunner().invoke(cli, ["start", "--repo", "demo", "--goal", "do thing"])
    assert r.exit_code == 0, r.output
    cmds = list_commands()
    assert any(c.command_type == "start_task" and c.repo_id == "demo" for c in cmds)


def test_pause_requires_exactly_one_target() -> None:
    init_db()
    r = CliRunner().invoke(cli, ["pause"])
    assert r.exit_code != 0


def test_pause_repo_enqueues_command() -> None:
    init_db()
    r = CliRunner().invoke(cli, ["pause", "--repo", "demo"])
    assert r.exit_code == 0
    cmds = list_commands()
    assert any(c.command_type == "pause_repo" for c in cmds)


def test_resume_system_uses_set_mode() -> None:
    init_db()
    r = CliRunner().invoke(cli, ["resume", "--system"])
    assert r.exit_code == 0
    cmds = list_commands()
    assert any(c.command_type == "set_mode" for c in cmds)


def test_stop_all_enqueues_stop_all() -> None:
    init_db()
    r = CliRunner().invoke(cli, ["stop-all"])
    assert r.exit_code == 0
    cmds = list_commands()
    assert any(c.command_type == "stop_all" for c in cmds)


def test_explain_stuck_carries_verbose_flag() -> None:
    init_db()
    r = CliRunner().invoke(cli, ["explain-stuck", "--task", "task_abc", "--verbose"])
    assert r.exit_code == 0
    cmds = list_commands()
    target = [c for c in cmds if c.command_type == "explain_stuck"][0]
    assert target.payload == {"verbose": True}
    assert target.task_id == "task_abc"


def test_tasks_empty_when_none() -> None:
    init_db()
    r = CliRunner().invoke(cli, ["tasks"])
    assert r.exit_code == 0
    assert "No tasks" in r.output


def test_repo_add_from_spec_writes_registry(tmp_path: Path) -> None:
    spec_path = tmp_path / "spec.json"
    spec_path.write_text(json.dumps({
        "id": "fromjson",
        "github_owner": "o",
        "github_repo": "r",
        "local_path": "/tmp/fromjson",
        "default_branch": "main",
        "forbidden_paths": [".env", ".env.*"],
    }))
    r = CliRunner().invoke(cli, ["repo", "add", "--from-spec", str(spec_path), "--no-probe"])
    assert r.exit_code == 0, r.output
    repos_path = Path(os.environ["CLAUDE247_REPOS_FILE"])
    data = yaml.safe_load(repos_path.read_text())
    assert data["repos"][0]["id"] == "fromjson"
