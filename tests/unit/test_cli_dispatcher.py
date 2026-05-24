from __future__ import annotations

import json

from click.testing import CliRunner

from gateway.cli import cli
from memory.db import init_db
from orchestrator.command_queue import enqueue


def test_dispatcher_once_idle_message() -> None:
    init_db()
    r = CliRunner().invoke(cli, ["dispatcher", "--once"])
    # idle is exit 0 per CLI design
    assert r.exit_code == 0
    assert "idle" in r.output


def test_dispatcher_once_handles_simple_command() -> None:
    init_db()
    enqueue("pause_repo", repo_id="demo")
    r = CliRunner().invoke(cli, ["dispatcher", "--once"])
    assert r.exit_code == 0
    assert "pause_repo" in r.output
    assert "succeeded" in r.output


def test_dispatcher_once_json_output() -> None:
    init_db()
    enqueue("resume_repo", repo_id="x")
    r = CliRunner().invoke(cli, ["dispatcher", "--once", "--json"])
    assert r.exit_code == 0
    payload = json.loads(r.output)
    assert payload["handled"] is True
    assert payload["command_type"] == "resume_repo"


def test_dispatcher_loop_with_max_iterations_terminates() -> None:
    init_db()
    enqueue("pause_repo", repo_id="a")
    enqueue("pause_repo", repo_id="b")
    r = CliRunner().invoke(cli, ["dispatcher", "--loop",
                                   "--interval", "0",
                                   "--max-iterations", "5"])
    assert r.exit_code == 0
