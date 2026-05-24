from __future__ import annotations

import os
import subprocess
from pathlib import Path

from orchestrator.path_guard import (
    matches_any,
    violations_in_diff,
    violations_in_workspace,
)


def test_matches_glob() -> None:
    assert matches_any(".env", [".env"])
    assert matches_any(".env.local", [".env.*"])
    assert matches_any(".github/workflows/ci.yml", [".github/**"])
    assert not matches_any("src/.env.example.py", [".env"])


def test_violations_in_diff_lists_offenders() -> None:
    files = [".env", "src/app.py", ".github/workflows/ci.yml"]
    v = violations_in_diff(files, forbidden_paths=[".env", ".github/**"])
    assert v == [".env", ".github/workflows/ci.yml"]


def test_violations_in_workspace_uses_git_diff(fake_repo: Path) -> None:
    # Create a forbidden file change in the fake repo
    (fake_repo / ".env").write_text("SECRET=1\n")
    subprocess.run(["git", "-C", str(fake_repo), "add", ".env"], check=True)
    subprocess.run(["git", "-C", str(fake_repo), "checkout", "-b", "feature"],
                    check=True)
    subprocess.run(
        ["git", "-C", str(fake_repo), "commit", "-m", "add env", "--quiet"],
        check=True, env={**os.environ,
                          "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t",
                          "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"})
    v = violations_in_workspace(fake_repo, forbidden_paths=[".env"],
                                 base_branch="main")
    assert ".env" in v
