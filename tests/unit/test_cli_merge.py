from __future__ import annotations

import json

import pytest
from click.testing import CliRunner

from gateway.cli import cli
from memory.db import init_db, open_db
from orchestrator.command_queue import list_commands
from orchestrator.ids import make_id, utc_now_iso


def test_approve_merge_enqueues_command() -> None:
    init_db()
    r = CliRunner().invoke(cli, ["approve-merge", "--repo", "demo", "--pr", "42"])
    assert r.exit_code == 0
    cmds = list_commands()
    assert any(c.command_type == "approve_merge" and c.repo_id == "demo"
               and c.pr_number == 42 for c in cmds)


def test_reject_merge_carries_reason() -> None:
    init_db()
    r = CliRunner().invoke(cli, ["reject-merge", "--repo", "demo", "--pr", "7",
                                  "--reason", "scope creep"])
    assert r.exit_code == 0
    cmds = list_commands()
    rej = next(c for c in cmds if c.command_type == "reject_merge")
    assert rej.payload == {"reason": "scope creep"}


def test_risk_command_404_when_missing() -> None:
    init_db()
    r = CliRunner().invoke(cli, ["risk", "--repo", "demo", "--pr", "1"])
    assert r.exit_code != 0
    assert "no risk score" in (r.output + (r.stderr or ""))


def test_risk_command_renders_when_recorded() -> None:
    init_db()
    now = utc_now_iso()
    with open_db() as conn:
        conn.execute("INSERT INTO repos (id, name, github_owner, github_repo, local_path, "
                     "default_branch, enabled, risk_level, config_json, created_at, updated_at) "
                     "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                     ("demo", "demo", "o", "r", "/tmp/x", "main", 1, "low", "{}", now, now))
        task_id = make_id("task")
        conn.execute(
            "INSERT INTO tasks (id, repo_id, goal, source, status, created_at, updated_at, "
            "payload_json) VALUES (?,?,?,?,?,?,?,?)",
            (task_id, "demo", "test goal", "cli", "pr_created", now, now, "{}"),
        )
        pr_id = make_id("pr")
        conn.execute(
            "INSERT INTO prs (id, repo_id, task_id, pr_number, branch, title, url, state, "
            "created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (pr_id, "demo", task_id, 9, "agent/demo/x/y", "test", "http://x", "open",
             now, now),
        )
        rid = make_id("rs")
        conn.execute(
            "INSERT INTO risk_scores (id, task_id, pr_id, score, level, factors_json, created_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (rid, task_id, pr_id, 12, "low",
             json.dumps([{"name": "files_touched_per_3", "weight": 3,
                          "reason": "2 files touched"}]),
             now),
        )
    r = CliRunner().invoke(cli, ["risk", "--repo", "demo", "--pr", "9"])
    assert r.exit_code == 0, r.output
    assert "score=12" in r.output
    assert "files_touched_per_3" in r.output
