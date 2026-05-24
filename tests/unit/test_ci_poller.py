from __future__ import annotations

import json
import time
from pathlib import Path

import pytest

from memory.db import init_db, open_db
from orchestrator import ci_poller
from orchestrator.ids import make_id, utc_now_iso
from orchestrator.repo_registry import RepoEntry


def _seed_pr_and_repo(repo_id: str = "demo", pr_number: int = 42) -> tuple[str, str]:
    init_db()
    now = utc_now_iso()
    with open_db() as conn:
        conn.execute(
            "INSERT INTO repos (id, name, github_owner, github_repo, local_path, "
            "default_branch, enabled, risk_level, config_json, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (repo_id, repo_id, "o", "r", "/tmp/x", "main", 1, "low",
             "{}", now, now),
        )
        tid = make_id("task")
        conn.execute(
            "INSERT INTO tasks (id, repo_id, goal, source, status, created_at, "
            "updated_at, payload_json) VALUES (?,?,?,?,?,?,?,?)",
            (tid, repo_id, "g", "cli", "pr_created", now, now, "{}"),
        )
        pid = make_id("pr")
        conn.execute(
            "INSERT INTO prs (id, repo_id, task_id, pr_number, branch, title, url, "
            "state, approval_state, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (pid, repo_id, tid, pr_number, "agent/x/y/z", "t",
             "http://x", "open", "required", now, now),
        )
    return repo_id, pid


class FakeGithub:
    def __init__(self, checks: list[dict]) -> None:
        self.checks = checks
        self.calls: list = []

    def pr_checks(self, repo: str, number: int) -> list[dict]:
        self.calls.append((repo, number))
        return self.checks


def test_poll_open_prs_records_ci_rows() -> None:
    _seed_pr_and_repo()
    fg = FakeGithub([
        {"name": "test", "bucket": "pass", "link": "x", "workflow": "ci"},
        {"name": "lint", "bucket": "pass", "link": "y", "workflow": "ci"},
    ])
    results = ci_poller.poll_open_prs(github=fg, min_poll_seconds=0)
    assert len(results) == 1
    r = results[0]
    assert r.checks_seen == 2
    assert r.verdict == "success"
    assert fg.calls[0] == ("o/r", 42)
    with open_db() as conn:
        n = conn.execute("SELECT COUNT(*) AS c FROM ci_results").fetchone()["c"]
        assert n == 2


def test_poll_aggregate_failure() -> None:
    _seed_pr_and_repo()
    fg = FakeGithub([
        {"name": "test", "bucket": "pass"},
        {"name": "build", "bucket": "fail"},
    ])
    r = ci_poller.poll_open_prs(github=fg, min_poll_seconds=0)[0]
    assert r.verdict == "failure"


def test_poll_aggregate_pending() -> None:
    _seed_pr_and_repo()
    fg = FakeGithub([
        {"name": "test", "bucket": "pass"},
        {"name": "deploy", "bucket": "pending"},
    ])
    r = ci_poller.poll_open_prs(github=fg, min_poll_seconds=0)[0]
    assert r.verdict == "pending"


def test_poll_skips_when_recent_poll(monkeypatch: pytest.MonkeyPatch) -> None:
    _seed_pr_and_repo()
    fg = FakeGithub([{"name": "x", "bucket": "pass"}])
    # First poll records.
    ci_poller.poll_open_prs(github=fg, min_poll_seconds=0)
    fg.calls.clear()
    # Second poll with a real min_poll should skip — most recent row is fresh.
    ci_poller.poll_open_prs(github=fg, min_poll_seconds=300)
    assert fg.calls == []


def test_poll_change_detected() -> None:
    _seed_pr_and_repo()
    # First batch: green.
    fg = FakeGithub([{"name": "x", "bucket": "pass"}])
    results = ci_poller.poll_open_prs(github=fg, min_poll_seconds=0)
    assert results[0].changed is False  # prior was None
    # Second batch: now red.
    fg.checks = [{"name": "x", "bucket": "fail"}]
    # Bypass the min_poll guard by waiting "in time"
    results = ci_poller.poll_open_prs(github=fg, min_poll_seconds=0,
                                       now=time.time() + 9999)
    assert results[0].changed is True
    assert results[0].verdict == "failure"


def test_poll_ignores_merged_or_closed_prs() -> None:
    init_db()
    now = utc_now_iso()
    with open_db() as conn:
        conn.execute(
            "INSERT INTO repos (id, name, github_owner, github_repo, local_path, "
            "default_branch, enabled, risk_level, config_json, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            ("r1", "r1", "o", "r", "/tmp/x", "main", 1, "low", "{}", now, now),
        )
        conn.execute(
            "INSERT INTO prs (id, repo_id, pr_number, branch, title, url, "
            "state, approval_state, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (make_id("pr"), "r1", 9, "b", "t", "u", "merged",
             "approved", now, now),
        )
    fg = FakeGithub([{"name": "x", "bucket": "pass"}])
    res = ci_poller.poll_open_prs(github=fg)
    assert res == []
    assert fg.calls == []


def test_poll_handles_gh_error_gracefully() -> None:
    _seed_pr_and_repo()
    from orchestrator.github_client import GitHubError

    class Bad:
        def pr_checks(self, repo, number):
            raise GitHubError("auth lost")

    res = ci_poller.poll_open_prs(github=Bad(), min_poll_seconds=0)
    # No result row when gh failed, but no exception either
    assert res == []
