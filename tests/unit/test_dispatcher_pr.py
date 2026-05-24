"""Dispatcher push + PR create + merge path.

Re-uses the FakeRunner pattern from test_dispatcher; injects a fake
github module so subprocess never gets called for gh.
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest
import yaml

from memory.db import init_db, open_db
from orchestrator.command_queue import enqueue
from orchestrator.dispatcher import HANDLERS, run_once
from orchestrator.github_client import GitHubError, PullRequest
from orchestrator.ids import make_id, utc_now_iso
from orchestrator.repo_registry import parse_registry, sync_to_db
from orchestrator.task_manager import TaskStatus, create_task, transition
from validator.judge_contract import normalize_response
from validator.validation_policy import ValidationOutcome


# ── shared fixtures ────────────────────────────────────────────────


def _seed_repo(*, auto_merge: bool = True) -> None:
    repos_path = Path(os.environ["CLAUDE247_REPOS_FILE"])
    repos_path.write_text(yaml.safe_dump({"repos": [{
        "id": "demo", "github_owner": "owner", "github_repo": "demo-repo",
        "local_path": "/tmp/demo", "forbidden_paths": [".env"],
        "auto_merge": {"enabled": auto_merge, "max_risk_score": 30,
                        "max_changed_lines": 300},
    }]}))
    init_db()
    sync_to_db(parse_registry(repos_path.read_text()))


def _flip_writes_on() -> None:
    cfg_dir = Path(os.environ["CLAUDE247_CONFIG_DIR"])
    (cfg_dir / "config.yaml").write_text(yaml.safe_dump({
        "system": {"allow_remote_writes": True},
    }))


class FakeRunner:
    backend = "local"
    pushed_calls: list = []
    rewired_calls: list = []
    commit_calls: list = []

    def __init__(self) -> None:
        self.pushed_calls = []
        self.rewired_calls = []
        self.commit_calls = []

    def prepare_workspace(self, *, task_id, repo_id, goal):
        ws = Path(os.environ["CLAUDE247_WORKSPACE_ROOT"]) / task_id
        ws.mkdir(parents=True, exist_ok=True)
        (ws / ".git").mkdir(exist_ok=True)
        ev = ws / ".evidence"
        ev.mkdir(exist_ok=True)
        (ev / "contract.md").write_text("# c\nDo X.\n")
        (ev / "diff_summary.md").write_text("# diff\n")
        (ev / "file_manifest.json").write_text("[]")
        (ev / "test_results.json").write_text(
            '[{"cmd":"pytest","exit":0,"stdout_tail":"","stderr_tail":"","duration_s":0.1}]'
        )
        (ev / "lint_results.json").write_text("[]")
        (ev / "build_results.json").write_text("[]")
        class _Prep:
            workspace = ws
            branch = f"agent/{repo_id}/{task_id}/g"
            repo_id_ = repo_id
            task_id_ = task_id
            used_existing = False
        return _Prep

    def get_repo(self, repo_id):
        from orchestrator.repo_registry import load_registry
        return [r for r in load_registry() if r.id == repo_id][0]

    def build_task_spec(self, **kw):
        return {"task_id": kw["task_id"]}

    def run(self, *, prep, spec, allow_roles=False):
        class _Outcome:
            exit_code = 0
            stderr = ""
            stdout = ""
            branch = prep.branch
            workspace = prep.workspace
        return _Outcome

    def commit_changes(self, prep, *, message, **_):
        self.commit_calls.append((prep.branch, message))
        return "abcd1234"  # pretend we committed

    def rewire_origin_to_github(self, prep, **_):
        self.rewired_calls.append(prep.branch)
        return "https://github.com/owner/demo-repo.git"

    def push_branch(self, prep, remote="origin"):
        # Only push when allow_remote_writes is on — but the wrapper in the
        # real RunnerManager handles that; here we just record.
        self.pushed_calls.append((prep.branch, remote))
        return True


def _all_pass_validator(inp):
    r = normalize_response("gemini", {
        "verdict": "PASS", "confidence": 0.9, "summary": "ok",
        "blocking_issues": [], "non_blocking_issues": [],
        "evidence_gaps": [], "recommended_next_action": "merge",
    })
    return ValidationOutcome(
        ok_for_auto_merge=True, needs_human=False,
        final_verdict="PASS", results=[r, r], reasons=["all PASS"],
    )


class FakeGithub:
    """Replaces orchestrator.github_client for the dispatcher tests."""
    GitHubError = GitHubError

    def __init__(self, *, merge_should_fail: bool = False) -> None:
        self.create_calls: list = []
        self.merge_calls: list = []
        self.mark_ready_calls: list = []
        self.merge_should_fail = merge_should_fail

    def create_draft_pr(self, *, repo, branch, title, body, base="main",
                         label=None, workspace=None):
        self.create_calls.append({"repo": repo, "branch": branch,
                                   "title": title, "body": body, "base": base})
        n = len(self.create_calls) + 100
        return PullRequest(
            repo=repo, number=n,
            url=f"https://github.com/{repo}/pull/{n}",
            branch=branch, title=title, state="draft", raw={},
        )

    def merge_pr(self, *, repo, number, method="squash", delete_branch=True,
                  body="", auto=False, admin=False):
        self.merge_calls.append({"repo": repo, "number": number, "method": method,
                                  "auto": auto, "admin": admin})
        if self.merge_should_fail:
            raise GitHubError("simulated merge failure")
        return True

    def mark_ready(self, repo, number):
        self.mark_ready_calls.append((repo, number))
        return True


# ── tests ──────────────────────────────────────────────────────────


def test_start_task_no_push_when_writes_off() -> None:
    _seed_repo()
    fr = FakeRunner()
    fg = FakeGithub()
    enqueue("start_task", repo_id="demo",
            payload={"repo_id": "demo", "goal": "no-push"})
    res = run_once(runner=fr, validator_fn=_all_pass_validator, github=fg,
                    notify_fn=lambda **_: None)
    assert res.handled
    # commit was still called, but push + create not
    assert fr.commit_calls
    assert fr.pushed_calls == []
    assert fg.create_calls == []
    assert res.result["pushed"] is False
    assert res.result["pr"] is None


def test_start_task_pushes_and_creates_pr_when_writes_on() -> None:
    _seed_repo()
    _flip_writes_on()
    fr = FakeRunner()
    fg = FakeGithub()
    enqueue("start_task", repo_id="demo",
            payload={"repo_id": "demo", "goal": "real push"})
    res = run_once(runner=fr, validator_fn=_all_pass_validator, github=fg,
                    notify_fn=lambda **_: None)
    assert res.handled
    assert fr.rewired_calls, "rewire_origin_to_github not called"
    assert fr.pushed_calls, "push_branch not called"
    assert fg.create_calls, "gh pr create not called"
    pr = res.result["pr"]
    assert pr["number"] == 101
    # PR row recorded
    with open_db() as conn:
        row = conn.execute("SELECT pr_number, approval_state, state "
                            "FROM prs WHERE repo_id = ?", ("demo",)).fetchone()
        assert row["pr_number"] == 101
        # auto_merge gate met → not_required (no approval)
        assert row["approval_state"] == "not_required"


def test_start_task_auto_merge_calls_gh_merge_and_records_merged() -> None:
    _seed_repo(auto_merge=True)
    _flip_writes_on()
    fr = FakeRunner()
    fg = FakeGithub()
    enqueue("start_task", repo_id="demo",
            payload={"repo_id": "demo", "goal": "auto merge me"})
    res = run_once(runner=fr, validator_fn=_all_pass_validator, github=fg,
                    notify_fn=lambda **_: None)
    assert res.handled
    assert res.result["merged"] is True
    assert fg.merge_calls and fg.merge_calls[0]["method"] == "squash"
    # Task should be merged
    with open_db() as conn:
        row = conn.execute(
            "SELECT status FROM tasks WHERE id = ?", (res.result["task_id"],),
        ).fetchone()
        assert row["status"] == "merged"
        pr_row = conn.execute("SELECT state, merged_at FROM prs WHERE repo_id = ?",
                               ("demo",)).fetchone()
        assert pr_row["state"] == "merged"
        assert pr_row["merged_at"]


def test_start_task_auto_merge_failure_keeps_task_failed() -> None:
    _seed_repo(auto_merge=True)
    _flip_writes_on()
    fr = FakeRunner()
    fg = FakeGithub(merge_should_fail=True)
    enqueue("start_task", repo_id="demo",
            payload={"repo_id": "demo", "goal": "merge breaks"})
    res = run_once(runner=fr, validator_fn=_all_pass_validator, github=fg,
                    notify_fn=lambda **_: None)
    assert res.handled
    assert res.result["merged"] is False
    assert "merge_error" in res.result
    with open_db() as conn:
        row = conn.execute(
            "SELECT status FROM tasks WHERE id = ?", (res.result["task_id"],),
        ).fetchone()
        assert row["status"] == "failed"


def test_start_task_waiting_approval_creates_pr_but_no_merge() -> None:
    _seed_repo(auto_merge=False)  # repo opted out → waiting_for_approval
    _flip_writes_on()
    fr = FakeRunner()
    fg = FakeGithub()
    enqueue("start_task", repo_id="demo",
            payload={"repo_id": "demo", "goal": "need approval"})
    res = run_once(runner=fr, validator_fn=_all_pass_validator, github=fg,
                    notify_fn=lambda **_: None)
    assert res.handled
    assert res.result["ruling"]["decision"] == "waiting_approval"
    assert fg.create_calls, "PR should be created for waiting_approval"
    assert fg.merge_calls == [], "PR must not merge before approval"
    with open_db() as conn:
        row = conn.execute(
            "SELECT status FROM tasks WHERE id = ?", (res.result["task_id"],),
        ).fetchone()
        assert row["status"] == "waiting_for_approval"
        pr_row = conn.execute(
            "SELECT approval_state FROM prs WHERE repo_id = ?", ("demo",),
        ).fetchone()
        assert pr_row["approval_state"] == "required"


def test_approve_merge_calls_gh_when_writes_on() -> None:
    _seed_repo()
    _flip_writes_on()
    # Pre-seed a PR + task + the operator's approve_merge command
    task = create_task("demo", "x")
    transition(task.id, TaskStatus.planning, message="m")
    transition(task.id, TaskStatus.validating, message="m")
    transition(task.id, TaskStatus.pr_created, message="m")
    transition(task.id, TaskStatus.waiting_for_approval, message="m")
    now = utc_now_iso()
    pid = make_id("pr")
    with open_db() as conn:
        conn.execute(
            "INSERT INTO prs (id, repo_id, task_id, pr_number, branch, title, url, "
            "state, approval_state, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (pid, "demo", task.id, 55, "agent/demo/x/y", "t",
             "https://github.com/owner/demo-repo/pull/55", "open", "required",
             now, now),
        )

    enqueue("approve_merge", repo_id="demo", pr_number=55)
    fg = FakeGithub()
    cmd = HANDLERS  # noqa
    # Use direct run_once with github injection
    res = run_once(github=fg, notify_fn=lambda **_: None)
    assert res.handled
    assert res.result["merged"] is True
    assert fg.merge_calls[0]["number"] == 55
    with open_db() as conn:
        row = conn.execute(
            "SELECT status FROM tasks WHERE id = ?", (task.id,)
        ).fetchone()
        assert row["status"] == "merged"


def test_approve_merge_records_only_when_writes_off() -> None:
    _seed_repo()
    # writes off (default)
    task = create_task("demo", "x")
    now = utc_now_iso()
    pid = make_id("pr")
    with open_db() as conn:
        conn.execute(
            "INSERT INTO prs (id, repo_id, task_id, pr_number, branch, title, url, "
            "state, approval_state, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (pid, "demo", task.id, 60, "agent/x/y/z", "t",
             "u", "open", "required", now, now),
        )
    enqueue("approve_merge", repo_id="demo", pr_number=60)
    fg = FakeGithub()
    res = run_once(github=fg, notify_fn=lambda **_: None)
    assert res.handled
    assert res.result["approved"] is True
    assert res.result["merged"] is False
    assert fg.merge_calls == []
