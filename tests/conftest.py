"""Pytest fixtures shared across unit + integration tests.

Most of our state-dependent code reads from ``~/.claude-code-247/``. We
*never* want tests to touch the user's real config or DB, so every test
session gets its own tmp dir wired in via env vars.
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def isolated_state_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Redirect CLAUDE247_CONFIG_DIR + CLAUDE247_STATE_DIR + CLAUDE247_DB_PATH
    + CLAUDE247_REPOS_FILE + CLAUDE247_WORKSPACE_ROOT to a tmp dir for every
    test."""
    cfg = tmp_path / "cfg"
    state = tmp_path / "state"
    ws = tmp_path / "workspaces"
    cfg.mkdir()
    state.mkdir()
    ws.mkdir()
    monkeypatch.setenv("CLAUDE247_CONFIG_DIR", str(cfg))
    monkeypatch.setenv("CLAUDE247_STATE_DIR", str(state))
    monkeypatch.setenv("CLAUDE247_DB_PATH", str(state / "claude247.db"))
    monkeypatch.setenv("CLAUDE247_REPOS_FILE", str(cfg / "repos.yaml"))
    monkeypatch.setenv("CLAUDE247_WORKSPACE_ROOT", str(ws))
    # Ensure no validator/anthropic keys are picked up from the host env
    # unless a test explicitly sets one. This also keeps the
    # claude_cli auth-mode detection deterministic (no ANTHROPIC_API_KEY
    # → reports local_claude_code by default).
    for var in ("GEMINI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"):
        monkeypatch.delenv(var, raising=False)
    return tmp_path


@pytest.fixture
def fake_repo(tmp_path: Path) -> Path:
    """A real on-disk git repo with an initial commit + a passing pytest.

    Tests that hit the runner manager use this so the manager can clone
    and run the configured test command without network access. Author
    identity is set via env vars so global git config doesn't matter.
    """
    repo = tmp_path / "fake-repo"
    repo.mkdir()
    env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "tester",
        "GIT_AUTHOR_EMAIL": "tester@example.com",
        "GIT_COMMITTER_NAME": "tester",
        "GIT_COMMITTER_EMAIL": "tester@example.com",
    }
    subprocess.run(["git", "init", "-q", "-b", "main", str(repo)], check=True)
    (repo / "src").mkdir()
    (repo / "src" / "lib.py").write_text("def add(a, b):\n    return a + b\n")
    (repo / "tests").mkdir()
    # Self-contained test so pytest passes without pythonpath / src layout
    # gymnastics. Tests that need to exercise a *failure* rewrite this file.
    (repo / "tests" / "test_lib.py").write_text(
        "def test_basic():\n"
        "    assert 2 + 2 == 4\n"
    )
    (repo / ".gitignore").write_text(".evidence/\n__pycache__/\n*.pyc\n")
    subprocess.run(["git", "-C", str(repo), "add", "."], check=True)
    subprocess.run(
        ["git", "-C", str(repo), "commit", "-m", "init", "--quiet"],
        check=True, env=env,
    )
    return repo
