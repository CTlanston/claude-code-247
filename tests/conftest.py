"""Pytest fixtures shared across unit + integration tests.

Most of our state-dependent code reads from ``~/.claude-code-247/``. We
*never* want tests to touch the user's real config or DB, so every test
session gets its own tmp dir wired in via env vars.
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def isolated_state_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Redirect CLAUDE247_CONFIG_DIR + CLAUDE247_STATE_DIR + CLAUDE247_DB_PATH
    + CLAUDE247_REPOS_FILE to a tmp dir for every test."""
    cfg = tmp_path / "cfg"
    state = tmp_path / "state"
    cfg.mkdir()
    state.mkdir()
    monkeypatch.setenv("CLAUDE247_CONFIG_DIR", str(cfg))
    monkeypatch.setenv("CLAUDE247_STATE_DIR", str(state))
    monkeypatch.setenv("CLAUDE247_DB_PATH", str(state / "claude247.db"))
    monkeypatch.setenv("CLAUDE247_REPOS_FILE", str(cfg / "repos.yaml"))
    # Ensure no validator keys are picked up from the host env unless a test
    # explicitly sets one.
    for var in ("GEMINI_API_KEY", "OPENAI_API_KEY"):
        monkeypatch.delenv(var, raising=False)
    return tmp_path
