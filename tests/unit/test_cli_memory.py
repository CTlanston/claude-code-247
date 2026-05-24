from __future__ import annotations

import json
import os
from pathlib import Path

import yaml
from click.testing import CliRunner

from gateway.cli import cli
from memory.db import init_db
from memory.repo_memory import CANONICAL_FILES
from orchestrator.repo_registry import parse_registry, sync_to_db


def _seed(fake_repo: Path) -> None:
    repos_path = Path(os.environ["CLAUDE247_REPOS_FILE"])
    repos_path.write_text(yaml.safe_dump({"repos": [{
        "id": "demo", "github_owner": "o", "github_repo": "r",
        "local_path": str(fake_repo), "forbidden_paths": [".env"],
    }]}))
    init_db()
    sync_to_db(parse_registry(repos_path.read_text()))


def test_memory_init_creates_files(fake_repo: Path) -> None:
    _seed(fake_repo)
    r = CliRunner().invoke(cli, ["memory", "init", "--repo", "demo"])
    assert r.exit_code == 0
    for name in CANONICAL_FILES:
        assert (fake_repo / ".agent" / f"{name}.md").exists()


def test_memory_init_unknown_repo_raises() -> None:
    init_db()
    r = CliRunner().invoke(cli, ["memory", "init", "--repo", "nope"])
    assert r.exit_code != 0


def test_memory_compile_empty_history(fake_repo: Path) -> None:
    _seed(fake_repo)
    r = CliRunner().invoke(cli, ["memory", "compile", "--repo", "demo", "--json"])
    assert r.exit_code == 0
    rows = json.loads(r.output)
    assert rows[0]["repo_id"] == "demo"
    assert rows[0]["memory_items_added"] == 0


def test_memory_compile_weekly_window(fake_repo: Path) -> None:
    _seed(fake_repo)
    r = CliRunner().invoke(cli, ["memory", "compile", "--weekly",
                                  "--repo", "demo"])
    assert r.exit_code == 0
    assert "demo [weekly]" in r.output
