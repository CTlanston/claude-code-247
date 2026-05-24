"""Tests for scripts/spawn_worktree.sh (Cycle 17 Track C2-init)."""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "spawn_worktree.sh"


def _run_script(args, cwd=None):
    return subprocess.run(
        [str(SCRIPT), *args],
        capture_output=True, text=True,
        cwd=str(cwd) if cwd else None, timeout=30,
    )


def test_script_exists_and_executable():
    assert SCRIPT.exists()
    assert os.access(SCRIPT, os.X_OK)


def test_script_usage_when_no_args(tmp_path):
    """Missing <name> arg → exit 64."""
    result = _run_script([], cwd=tmp_path)
    assert result.returncode == 64
    assert "usage" in result.stderr.lower()


def test_script_noop_when_worktree_exists():
    """If `worktrees/stream-1` already exists as a worktree, the script
    should report noop and exit 0 (idempotent)."""
    # We added stream-1 in cycle 17's main flow; this test confirms
    # re-running is safe.
    if not (REPO_ROOT / "worktrees" / "stream-1").exists():
        pytest.skip("worktrees/stream-1 not present in this run")
    result = _run_script(["stream-1"])
    assert result.returncode == 0
    # JSON event in stdout
    data = json.loads(result.stdout.strip().splitlines()[-1])
    assert data["event"] == "noop"
    assert data["name"] == "stream-1"


def test_script_creates_new_worktree(tmp_path, monkeypatch):
    """Spawning a fresh-name worktree should create the entry."""
    if not (REPO_ROOT / ".git").exists():
        pytest.skip("not in a git repo")
    fresh_name = f"pytest-{os.getpid()}-fresh"
    result = _run_script([fresh_name])
    try:
        assert result.returncode == 0
        data = json.loads(result.stdout.strip().splitlines()[-1])
        assert data["event"] == "created"
        # Verify via git itself
        out = subprocess.run(
            ["git", "-C", str(REPO_ROOT), "worktree", "list",
             "--porcelain"],
            capture_output=True, text=True, check=True, timeout=10,
        )
        assert f"worktrees/{fresh_name}" in out.stdout
    finally:
        # Cleanup: remove the worktree we just created
        subprocess.run(
            ["git", "-C", str(REPO_ROOT), "worktree", "remove",
             "--force", f"worktrees/{fresh_name}"],
            capture_output=True, text=True, timeout=10,
        )
        # Also delete the branch (since `-b` created one)
        subprocess.run(
            ["git", "-C", str(REPO_ROOT), "branch", "-D",
             f"autoevo/worktree-{fresh_name}"],
            capture_output=True, text=True, timeout=10,
        )
