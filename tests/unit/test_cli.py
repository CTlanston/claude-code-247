from __future__ import annotations

import json
from pathlib import Path

import yaml
from click.testing import CliRunner

from gateway.cli import cli


def test_cli_help_lists_subcommands() -> None:
    r = CliRunner().invoke(cli, ["--help"])
    assert r.exit_code == 0
    for sub in ("doctor", "repos", "status"):
        assert sub in r.output


def test_status_runs_without_registry() -> None:
    r = CliRunner().invoke(cli, ["status"])
    assert r.exit_code == 0
    assert "claude-code-247 status" in r.output


def test_status_json_is_parseable() -> None:
    r = CliRunner().invoke(cli, ["status", "--json"])
    assert r.exit_code == 0
    payload = json.loads(r.output)
    assert payload["system"]["auth_mode"] == "local_claude_code"
    assert payload["system"]["allow_remote_writes"] is False


def test_status_plain_one_line_per_field() -> None:
    r = CliRunner().invoke(cli, ["status", "--plain"])
    assert r.exit_code == 0
    lines = [ln for ln in r.output.strip().splitlines() if ln]
    # plain mode should be tight: ≤6 lines for an empty system.
    assert 2 <= len(lines) <= 6, r.output


def test_repos_lists_entries_after_writing_yaml(tmp_path: Path) -> None:
    import os
    repos_path = Path(os.environ["CLAUDE247_REPOS_FILE"])
    repos_path.write_text(yaml.safe_dump({"repos": [
        {"id": "demo", "github_owner": "owner", "github_repo": "demo-repo",
         "local_path": str(tmp_path), "forbidden_paths": [".env"]}
    ]}))
    r = CliRunner().invoke(cli, ["repos"])
    assert r.exit_code == 0, r.output
    assert "demo" in r.output
    assert "owner/demo-repo" in r.output


def test_repos_json_shape() -> None:
    r = CliRunner().invoke(cli, ["repos", "--json", "--no-sync"])
    assert r.exit_code == 0
    payload = json.loads(r.output)
    assert payload == {"repos": [], "count": 0}


def test_doctor_runs_and_can_emit_json() -> None:
    r = CliRunner().invoke(cli, ["doctor", "--json"])
    # Exit code may be 0 or 2 depending on host. The JSON must always be parseable
    # and contain a checks array.
    assert r.exit_code in (0, 2), r.output
    payload = json.loads(r.output)
    assert "checks" in payload
    assert isinstance(payload["checks"], list)
    assert payload["checks"]
