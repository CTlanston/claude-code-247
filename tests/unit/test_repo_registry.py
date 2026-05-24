from __future__ import annotations

import os
from pathlib import Path

import pytest
import yaml

from memory.db import init_db, open_db
from orchestrator.repo_registry import (
    RepoRegistryError,
    default_repos_path,
    load_registry,
    parse_registry,
    sync_to_db,
)


def _good_yaml() -> str:
    return yaml.safe_dump({
        "repos": [
            {
                "id": "alpha",
                "github_owner": "owner",
                "github_repo": "alpha-repo",
                "local_path": "/tmp/alpha",
                "default_branch": "main",
                "enabled": True,
                "forbidden_paths": [".env"],
            },
            {
                "id": "beta",
                "github_owner": "owner",
                "github_repo": "beta-repo",
                "local_path": "~/projects/beta",
                "enabled": False,
                "risk_level": "medium",
                "forbidden_paths": [".env", ".github/**"],
            },
        ]
    })


def test_parse_returns_empty_when_no_file() -> None:
    assert parse_registry("") == []


def test_parse_validates_top_level_is_mapping() -> None:
    with pytest.raises(RepoRegistryError):
        parse_registry("- not\n- a\n- map")


def test_parse_validates_repos_list() -> None:
    with pytest.raises(RepoRegistryError):
        parse_registry(yaml.safe_dump({"repos": "not a list"}))


def test_parse_requires_required_fields() -> None:
    bad = yaml.safe_dump({"repos": [{"id": "a", "github_owner": "x"}]})  # missing repo / local_path
    with pytest.raises(RepoRegistryError) as exc:
        parse_registry(bad)
    assert "missing required field" in str(exc.value)


def test_parse_requires_nonempty_forbidden_paths() -> None:
    cfg_dir = Path(os.environ["CLAUDE247_CONFIG_DIR"])
    # The default.yaml ships with a non-empty default. To trigger the error,
    # override repo_defaults via user config.yaml with forbidden_paths: [].
    (cfg_dir / "config.yaml").write_text(yaml.safe_dump({
        "repo_defaults": {"forbidden_paths": []},
    }))
    bad = yaml.safe_dump({"repos": [{
        "id": "x", "github_owner": "o", "github_repo": "r", "local_path": "/tmp/x",
        "forbidden_paths": [],
    }]})
    with pytest.raises(RepoRegistryError) as exc:
        parse_registry(bad)
    assert "forbidden_paths" in str(exc.value)


def test_parse_rejects_duplicate_ids() -> None:
    bad = yaml.safe_dump({"repos": [
        {"id": "dup", "github_owner": "o", "github_repo": "r1", "local_path": "/tmp/a",
         "forbidden_paths": [".env"]},
        {"id": "dup", "github_owner": "o", "github_repo": "r2", "local_path": "/tmp/b",
         "forbidden_paths": [".env"]},
    ]})
    with pytest.raises(RepoRegistryError):
        parse_registry(bad)


def test_parse_expands_tilde_and_inherits_defaults() -> None:
    entries = parse_registry(_good_yaml())
    assert [e.id for e in entries] == ["alpha", "beta"]
    beta = entries[1]
    assert beta.enabled is False
    assert beta.risk_level == "medium"
    assert "~" not in beta.local_path  # tilde expanded
    assert beta.local_path.endswith("/projects/beta")
    # Defaults supplied even when the per-repo entry doesn't specify them
    alpha = entries[0]
    assert alpha.default_branch == "main"
    assert alpha.risk_level == "low"


def test_load_registry_returns_empty_when_path_missing() -> None:
    assert load_registry() == []


def test_sync_to_db_inserts_updates_and_deletes(tmp_path: Path) -> None:
    entries = parse_registry(_good_yaml())
    init_db()
    n = sync_to_db(entries)
    assert n == 2
    with open_db() as conn:
        rows = list(conn.execute("SELECT id, enabled, risk_level FROM repos ORDER BY id"))
        assert [r["id"] for r in rows] == ["alpha", "beta"]
        # enabled stored as 0/1
        assert rows[0]["enabled"] == 1
        assert rows[1]["enabled"] == 0

    # second sync with one removed: should reduce count
    smaller = parse_registry(yaml.safe_dump({"repos": [
        {"id": "alpha", "github_owner": "owner", "github_repo": "alpha-repo",
         "local_path": "/tmp/alpha", "forbidden_paths": [".env"]},
    ]}))
    n2 = sync_to_db(smaller)
    assert n2 == 1
    with open_db() as conn:
        rows = list(conn.execute("SELECT id FROM repos"))
        assert [r["id"] for r in rows] == ["alpha"]


def test_default_repos_path_uses_env_when_set() -> None:
    p = default_repos_path()
    assert p == Path(os.environ["CLAUDE247_REPOS_FILE"])
