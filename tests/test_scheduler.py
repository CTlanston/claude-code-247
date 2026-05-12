"""Tests for orchestrator.scheduler (Cycle 17 Track C2-init skeleton)."""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
os.environ.setdefault("STATE_DIR", str(REPO_ROOT / "state"))
sys.path.insert(0, str(REPO_ROOT / "orchestrator"))
import scheduler as sch  # noqa: E402


# --- _parse_worktree_porcelain --------------------------------------------


def test_parse_empty_porcelain():
    assert sch._parse_worktree_porcelain("") == []


def test_parse_single_worktree_porcelain():
    text = (
        "worktree /repo\n"
        "HEAD abc1234\n"
        "branch refs/heads/main\n"
    )
    out = sch._parse_worktree_porcelain(text)
    assert len(out) == 1
    assert out[0].path == Path("/repo")
    assert out[0].branch == "main"
    assert out[0].head_sha == "abc1234"
    assert out[0].detached is False


def test_parse_two_worktrees_with_separator():
    text = (
        "worktree /a\n"
        "HEAD aaa1\n"
        "branch refs/heads/foo\n"
        "\n"
        "worktree /b\n"
        "HEAD bbb2\n"
        "branch refs/heads/bar\n"
    )
    out = sch._parse_worktree_porcelain(text)
    assert len(out) == 2
    assert out[0].branch == "foo"
    assert out[1].branch == "bar"


def test_parse_detached_worktree():
    text = (
        "worktree /det\n"
        "HEAD def4567\n"
        "detached\n"
    )
    out = sch._parse_worktree_porcelain(text)
    assert len(out) == 1
    assert out[0].detached is True
    assert out[0].branch is None


def test_parse_bare_repo():
    text = (
        "worktree /bare\n"
        "bare\n"
    )
    out = sch._parse_worktree_porcelain(text)
    assert len(out) == 1
    assert out[0].bare is True


# --- discover_worktrees -- real repo --------------------------------------


def test_discover_worktrees_real_repo_returns_at_least_one():
    """Run against the actual repo — should find at least the primary."""
    out = sch.discover_worktrees(REPO_ROOT)
    assert len(out) >= 1
    # Primary worktree should be at REPO_ROOT
    paths = {w.path.resolve() for w in out}
    assert REPO_ROOT.resolve() in paths


def test_discover_worktrees_handles_missing_git(tmp_path):
    """If the directory isn't a git repo, return []."""
    # tmp_path is not inside a git repo
    out = sch.discover_worktrees(tmp_path)
    assert out == []


# --- Scheduler -----------------------------------------------------------


def test_scheduler_refresh_populates_worktrees():
    s = sch.Scheduler(repo_root=REPO_ROOT)
    assert s.worktrees == []
    s.refresh()
    assert len(s.worktrees) >= 1


def test_scheduler_next_idle_skips_primary():
    """next_idle_worktree returns a non-primary worktree (or None)."""
    s = sch.Scheduler(repo_root=REPO_ROOT)
    s.refresh()
    nxt = s.next_idle_worktree()
    if nxt is not None:
        # The returned worktree's path should NOT be the repo root
        assert nxt.path.resolve() != REPO_ROOT.resolve()


def test_scheduler_next_idle_respects_in_progress_marker(tmp_path):
    """If a worktree has an .in-progress file, it's skipped."""
    # Build synthetic worktree list
    s = sch.Scheduler(repo_root=tmp_path)
    busy = tmp_path / "busy"
    free = tmp_path / "free"
    busy.mkdir()
    free.mkdir()
    (busy / ".in-progress").write_text("cycle-X")
    s.worktrees = [
        sch.Worktree(path=tmp_path, branch="main"),       # primary
        sch.Worktree(path=busy, branch="b1"),
        sch.Worktree(path=free, branch="b2"),
    ]
    nxt = s.next_idle_worktree()
    assert nxt is not None
    assert nxt.path == free


def test_scheduler_next_idle_returns_none_when_all_busy(tmp_path):
    s = sch.Scheduler(repo_root=tmp_path)
    busy = tmp_path / "busy"
    busy.mkdir()
    (busy / ".in-progress").write_text("x")
    s.worktrees = [
        sch.Worktree(path=tmp_path, branch="main"),  # primary
        sch.Worktree(path=busy, branch="b1"),         # busy
    ]
    assert s.next_idle_worktree() is None
