from __future__ import annotations

import json
import subprocess

import pytest

from orchestrator import github_client as gh
from orchestrator.github_client import GitHubError, PullRequest


def _stub_subprocess(monkeypatch, *, returncode: int = 0,
                     stdout: str = "", stderr: str = ""):
    captured: dict = {"calls": []}

    def fake_run(argv, *, capture_output=False, text=False, timeout=None, **_):
        captured["calls"].append(argv)
        class _Proc:
            pass
        p = _Proc()
        p.returncode = returncode
        p.stdout = stdout
        p.stderr = stderr
        return p

    monkeypatch.setattr(subprocess, "run", fake_run)
    return captured


def test_create_draft_pr_builds_expected_argv(monkeypatch: pytest.MonkeyPatch) -> None:
    cap = _stub_subprocess(
        monkeypatch, returncode=0,
        stdout="https://github.com/owner/repo/pull/42\n",
    )
    pr = gh.create_draft_pr(
        repo="owner/repo", branch="agent/x/y/z", base="main",
        title="agent: foo", body="body text",
    )
    assert pr.number == 42
    assert pr.url.endswith("/pull/42")
    assert pr.state == "draft"
    assert cap["calls"][0][:5] == ["gh", "pr", "create", "--repo", "owner/repo"]
    assert "--draft" in cap["calls"][0]
    assert "--head" in cap["calls"][0]
    assert "agent/x/y/z" in cap["calls"][0]


def test_create_draft_pr_raises_on_gh_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    _stub_subprocess(monkeypatch, returncode=1, stderr="bad credentials")
    with pytest.raises(GitHubError) as exc:
        gh.create_draft_pr(repo="o/r", branch="b", title="t", body="b")
    assert "bad credentials" in str(exc.value)


def test_view_pr_parses_json(monkeypatch: pytest.MonkeyPatch) -> None:
    body = json.dumps({
        "number": 7, "url": "https://github.com/o/r/pull/7",
        "headRefName": "feature", "title": "do thing",
        "isDraft": False, "state": "OPEN", "mergedAt": None,
    })
    _stub_subprocess(monkeypatch, returncode=0, stdout=body)
    pr = gh.view_pr("o/r", 7)
    assert pr.number == 7
    assert pr.state == "open"
    assert pr.branch == "feature"


def test_view_pr_classifies_merged(monkeypatch: pytest.MonkeyPatch) -> None:
    body = json.dumps({
        "number": 7, "url": "x", "headRefName": "b",
        "title": "t", "isDraft": False, "state": "MERGED",
        "mergedAt": "2026-05-24T13:00Z",
    })
    _stub_subprocess(monkeypatch, returncode=0, stdout=body)
    assert gh.view_pr("o/r", 7).state == "merged"


def test_view_pr_raises_on_non_json(monkeypatch: pytest.MonkeyPatch) -> None:
    _stub_subprocess(monkeypatch, returncode=0, stdout="not json")
    with pytest.raises(GitHubError):
        gh.view_pr("o/r", 1)


def test_merge_pr_default_squash(monkeypatch: pytest.MonkeyPatch) -> None:
    cap = _stub_subprocess(monkeypatch, returncode=0, stdout="merged")
    ok = gh.merge_pr(repo="o/r", number=9)
    assert ok is True
    argv = cap["calls"][0]
    assert "--squash" in argv
    assert "--auto" in argv
    assert "--delete-branch" in argv
    assert "9" in argv


def test_merge_pr_rejects_unknown_method() -> None:
    with pytest.raises(ValueError):
        gh.merge_pr(repo="o/r", number=1, method="cherry-pick")


def test_merge_pr_raises_on_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    _stub_subprocess(monkeypatch, returncode=1, stderr="not approved")
    with pytest.raises(GitHubError):
        gh.merge_pr(repo="o/r", number=2)


def test_pr_comment(monkeypatch: pytest.MonkeyPatch) -> None:
    cap = _stub_subprocess(monkeypatch, returncode=0)
    ok = gh.pr_comment("o/r", 5, "hi")
    assert ok is True
    assert cap["calls"][0][:4] == ["gh", "pr", "comment", "5"]
    assert "--body" in cap["calls"][0]


def test_run_wraps_filenotfound(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*a, **kw):
        raise FileNotFoundError("gh missing")
    monkeypatch.setattr(subprocess, "run", boom)
    with pytest.raises(GitHubError):
        gh.create_draft_pr(repo="o/r", branch="b", title="t", body="b")
