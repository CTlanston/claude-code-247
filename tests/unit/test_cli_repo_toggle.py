"""M16: claude247 repo enable/disable."""
from __future__ import annotations

import json
import os
from pathlib import Path

import yaml
from click.testing import CliRunner

from gateway.cli import cli
from memory.db import init_db, open_db
from orchestrator.repo_registry import parse_registry, sync_to_db


def _seed_two_repos(fake_repo: Path) -> None:
    repos_path = Path(os.environ["CLAUDE247_REPOS_FILE"])
    repos_path.write_text(yaml.safe_dump({"repos": [
        {"id": "alpha", "github_owner": "o", "github_repo": "alpha",
         "local_path": str(fake_repo), "forbidden_paths": [".env"],
         "enabled": True},
        {"id": "beta", "github_owner": "o", "github_repo": "beta",
         "local_path": str(fake_repo), "forbidden_paths": [".env"],
         "enabled": True},
    ]}))
    init_db()
    sync_to_db(parse_registry(repos_path.read_text()))


def test_disable_flips_yaml_and_db(fake_repo: Path) -> None:
    _seed_two_repos(fake_repo)
    r = CliRunner().invoke(cli, ["repo", "disable", "--repo", "alpha"])
    assert r.exit_code == 0, r.output
    assert "disabled" in r.output

    repos_path = Path(os.environ["CLAUDE247_REPOS_FILE"])
    yaml_body = yaml.safe_load(repos_path.read_text())
    alpha = next(x for x in yaml_body["repos"] if x["id"] == "alpha")
    beta = next(x for x in yaml_body["repos"] if x["id"] == "beta")
    assert alpha["enabled"] is False
    assert beta["enabled"] is True

    with open_db() as conn:
        row = conn.execute("SELECT enabled FROM repos WHERE id = ?", ("alpha",)).fetchone()
        assert row["enabled"] == 0


def test_enable_after_disable_restores(fake_repo: Path) -> None:
    _seed_two_repos(fake_repo)
    CliRunner().invoke(cli, ["repo", "disable", "--repo", "alpha"])
    r = CliRunner().invoke(cli, ["repo", "enable", "--repo", "alpha"])
    assert r.exit_code == 0
    assert "enabled" in r.output

    with open_db() as conn:
        row = conn.execute("SELECT enabled FROM repos WHERE id = ?", ("alpha",)).fetchone()
        assert row["enabled"] == 1


def test_unknown_repo_errors(fake_repo: Path) -> None:
    _seed_two_repos(fake_repo)
    r = CliRunner().invoke(cli, ["repo", "disable", "--repo", "ghost"])
    assert r.exit_code != 0
    assert "unknown repo_id" in (r.output + (r.stderr or ""))


def test_already_state_is_noop(fake_repo: Path) -> None:
    _seed_two_repos(fake_repo)
    r = CliRunner().invoke(cli, ["repo", "enable", "--repo", "alpha"])
    assert r.exit_code == 0
    assert "already enabled" in r.output


def test_disable_then_start_task_is_deferred(fake_repo: Path) -> None:
    """End-to-end: disabling a repo makes the dispatcher refuse start_task
    for it."""
    _seed_two_repos(fake_repo)
    CliRunner().invoke(cli, ["repo", "disable", "--repo", "alpha"])
    from orchestrator.command_queue import enqueue
    from orchestrator.dispatcher import run_once
    enqueue("start_task", repo_id="alpha",
            payload={"repo_id": "alpha", "goal": "x"})
    res = run_once(poll_ci=False)
    assert res.handled
    assert res.result.get("deferred") is True
    assert "disabled" in res.result.get("reason", "").lower()


def test_json_output(fake_repo: Path) -> None:
    _seed_two_repos(fake_repo)
    r = CliRunner().invoke(cli, ["repo", "disable", "--repo", "alpha", "--json"])
    assert r.exit_code == 0
    payload = json.loads(r.output)
    assert payload == {"repo_id": "alpha", "prior": True, "now": False}
