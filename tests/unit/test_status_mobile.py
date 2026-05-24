"""M16: claude247 status --plain matches the directive §8 mobile shape."""
from __future__ import annotations

import json
import os
from pathlib import Path

import yaml
from click.testing import CliRunner

from gateway.cli import cli
from memory.db import init_db, open_db
from orchestrator.command_queue import enqueue
from orchestrator.ids import make_id, utc_now_iso
from orchestrator.repo_registry import parse_registry, sync_to_db
from orchestrator.task_manager import TaskStatus, create_task, transition


def _seed(fake_repo: Path) -> None:
    repos_path = Path(os.environ["CLAUDE247_REPOS_FILE"])
    repos_path.write_text(yaml.safe_dump({"repos": [{
        "id": "demo", "github_owner": "o", "github_repo": "r",
        "local_path": str(fake_repo), "forbidden_paths": [".env"],
        "enabled": True,
    }]}))
    init_db()
    sync_to_db(parse_registry(repos_path.read_text()))


def test_plain_status_minimal_shape() -> None:
    init_db()
    r = CliRunner().invoke(cli, ["status", "--plain"])
    assert r.exit_code == 0
    for required in ("System:", "Repos enabled:", "Active tasks:",
                      "Stuck tasks:", "Need approval:", "Today:"):
        assert required in r.output, f"missing {required!r} in plain status"


def test_plain_status_lists_stuck_and_suggests_next(fake_repo: Path) -> None:
    _seed(fake_repo)
    t = create_task("demo", "g")
    transition(t.id, TaskStatus.planning)
    transition(t.id, TaskStatus.stuck, message="model timeout")
    r = CliRunner().invoke(cli, ["status", "--plain"])
    assert r.exit_code == 0
    assert "Stuck tasks: 1" in r.output
    assert "Next actions:" in r.output
    assert f"claude247 explain-stuck --task {t.id}" in r.output


def test_plain_status_lists_approval_action(fake_repo: Path) -> None:
    _seed(fake_repo)
    now = utc_now_iso()
    tid = make_id("task")
    pid = make_id("pr")
    with open_db() as conn:
        conn.execute(
            "INSERT INTO tasks (id, repo_id, goal, source, status, created_at, "
            "updated_at, payload_json) VALUES (?,?,?,?,?,?,?,?)",
            (tid, "demo", "g", "cli", "waiting_for_approval", now, now, "{}"),
        )
        conn.execute(
            "INSERT INTO prs (id, repo_id, task_id, pr_number, branch, title, url, "
            "state, approval_state, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (pid, "demo", tid, 77, "b", "t", "u", "open", "required", now, now),
        )
    r = CliRunner().invoke(cli, ["status", "--plain"])
    assert r.exit_code == 0
    assert "Need approval: 1" in r.output
    assert "claude247 approve-merge --repo demo --pr 77" in r.output


def test_json_status_includes_new_fields() -> None:
    init_db()
    r = CliRunner().invoke(cli, ["status", "--json"])
    assert r.exit_code == 0
    payload = json.loads(r.output)
    for key in ("active", "stuck", "waiting_approval_tasks",
                 "today_completed", "today_failed", "next_actions"):
        assert key in payload, f"missing {key!r} in JSON status"
