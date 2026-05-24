from __future__ import annotations

import os
import subprocess
from pathlib import Path

import yaml

from memory.db import init_db, open_db
from orchestrator.onboarding import (
    append_to_registry,
    onboard,
    probe_local_path,
    validate_spec,
)


def _good_spec(rid: str = "alpha", local: str = "/tmp/alpha") -> dict:
    return {
        "id": rid,
        "github_owner": "owner",
        "github_repo": "alpha-repo",
        "local_path": local,
        "default_branch": "main",
        "forbidden_paths": [".env", ".env.*"],
    }


def test_validate_spec_passes_good_spec() -> None:
    r = validate_spec(_good_spec())
    assert r.ok
    assert r.errors == []


def test_validate_spec_flags_missing_fields() -> None:
    r = validate_spec({"id": "x"})
    assert not r.ok
    assert any("github_owner" in e for e in r.errors)
    assert any("github_repo" in e for e in r.errors)
    assert any("local_path" in e for e in r.errors)


def test_validate_spec_blocks_empty_forbidden_paths() -> None:
    spec = _good_spec()
    spec["forbidden_paths"] = []
    r = validate_spec(spec)
    assert not r.ok
    assert any("forbidden_paths" in e for e in r.errors)


def test_validate_spec_rejects_duplicate_id() -> None:
    r = validate_spec(_good_spec("dup"), existing_ids={"dup"})
    assert not r.ok
    assert any("already exists" in e for e in r.errors)


def test_validate_spec_warns_when_dotenv_missing() -> None:
    spec = _good_spec()
    spec["forbidden_paths"] = ["secrets/**"]
    r = validate_spec(spec)
    assert r.ok
    assert any(".env" in w for w in r.warnings)


def test_probe_local_path_errors_when_missing() -> None:
    r = probe_local_path("/tmp/definitely-does-not-exist-cc247", "o", "r", "main")
    assert not r.ok
    assert any("does not exist" in e for e in r.errors)


def test_probe_local_path_errors_when_not_git(tmp_path: Path) -> None:
    p = tmp_path / "norepo"
    p.mkdir()
    r = probe_local_path(str(p), "o", "r", "main")
    assert not r.ok
    assert any("not a git repo" in e for e in r.errors)


def test_probe_local_path_passes_for_real_git_repo(tmp_path: Path) -> None:
    repo = tmp_path / "ok"
    repo.mkdir()
    subprocess.run(["git", "init", "-q", "-b", "main", str(repo)], check=True)
    subprocess.run(["git", "-C", str(repo), "remote", "add", "origin",
                    "git@github.com:owner/ok.git"], check=True)
    # an empty repo has no branches until first commit; create one.
    subprocess.run(["git", "-C", str(repo), "commit", "--allow-empty",
                    "-m", "init", "--quiet"], check=True,
                   env={**os.environ,
                        "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t",
                        "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"})
    r = probe_local_path(str(repo), "owner", "ok", "main")
    assert r.ok, r.errors


def test_append_to_registry_creates_file_and_returns_entry() -> None:
    entry = append_to_registry(_good_spec("first", "/tmp/x"))
    assert entry.id == "first"
    path = Path(os.environ["CLAUDE247_REPOS_FILE"])
    data = yaml.safe_load(path.read_text())
    assert len(data["repos"]) == 1


def test_onboard_writes_registry_and_db_with_probe_disabled() -> None:
    res = onboard(_good_spec("beta", "/tmp/beta"), probe_local=False)
    assert res.ok, res.errors
    init_db()
    with open_db() as conn:
        row = conn.execute("SELECT id FROM repos WHERE id = ?", ("beta",)).fetchone()
        assert row is not None


def test_onboard_rejects_duplicate() -> None:
    onboard(_good_spec("gamma", "/tmp/g"), probe_local=False)
    res2 = onboard(_good_spec("gamma", "/tmp/g"), probe_local=False)
    assert not res2.ok
    assert any("already exists" in e for e in res2.errors)
