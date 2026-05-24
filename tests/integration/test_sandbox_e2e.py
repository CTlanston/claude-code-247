"""Golden end-to-end test against an in-process sandbox.

Drives the full dispatcher pipeline (start_task → workspace → worker →
validators → risk → merge policy → push/PR → merge) with:

  * a real on-disk fake_repo (the conftest fixture)
  * a FakeRunner that writes a minimal evidence package
  * a fake validator (both judges PASS)
  * a FakeGithub that records calls

Asserts the resulting DB state, evidence, and PR record.
"""
from __future__ import annotations

import os
from pathlib import Path

import yaml

from memory.db import init_db, open_db
from orchestrator import system_state
from orchestrator.command_queue import enqueue
from orchestrator.dispatcher import run_once
from orchestrator.github_client import GitHubError, PullRequest
from orchestrator.repo_registry import parse_registry, sync_to_db
from validator.judge_contract import normalize_response
from validator.validation_policy import ValidationOutcome


def _seed(fake_repo: Path, *, auto_merge: bool = True) -> None:
    repos_path = Path(os.environ["CLAUDE247_REPOS_FILE"])
    repos_path.write_text(yaml.safe_dump({"repos": [{
        "id": "sandbox",
        "github_owner": "owner",
        "github_repo": "sandbox-repo",
        "local_path": str(fake_repo),
        "default_branch": "main",
        "forbidden_paths": [".env"],
        "auto_merge": {"enabled": auto_merge, "max_risk_score": 30,
                        "max_changed_lines": 300, "method": "squash"},
    }]}))
    init_db()
    sync_to_db(parse_registry(repos_path.read_text()))


def _flip_writes_on() -> None:
    cfg_dir = Path(os.environ["CLAUDE247_CONFIG_DIR"])
    (cfg_dir / "config.yaml").write_text(yaml.safe_dump({
        "system": {"allow_remote_writes": True},
    }))


class _Prep:
    def __init__(self, ws, branch, repo_id, task_id):
        self.workspace = ws
        self.branch = branch
        self.repo_id_ = repo_id
        self.task_id_ = task_id
        self.used_existing = False


class SandboxRunner:
    backend = "local"

    def __init__(self):
        self.events: list[str] = []

    def prepare_workspace(self, *, task_id, repo_id, goal):
        ws = Path(os.environ["CLAUDE247_WORKSPACE_ROOT"]) / task_id
        ws.mkdir(parents=True, exist_ok=True)
        (ws / ".git").mkdir(exist_ok=True)
        ev = ws / ".evidence"
        ev.mkdir(exist_ok=True)
        (ev / "contract.md").write_text(
            f"# Contract\nGoal: {goal}\nDeliver per the worker.\n"
        )
        (ev / "diff_summary.md").write_text("```\nsrc/lib.py | 5 +\n```\n")
        (ev / "file_manifest.json").write_text('["src/lib.py", "tests/test_lib.py"]')
        (ev / "test_results.json").write_text(
            '[{"cmd":"pytest","exit":0,"stdout_tail":"1 passed",'
            '"stderr_tail":"","duration_s":0.05}]'
        )
        (ev / "lint_results.json").write_text("[]")
        (ev / "build_results.json").write_text("[]")
        self.events.append("prepare_workspace")
        return _Prep(ws, f"agent/{repo_id}/{task_id}/g", repo_id, task_id)

    def get_repo(self, repo_id):
        from orchestrator.repo_registry import load_registry
        return [r for r in load_registry() if r.id == repo_id][0]

    def build_task_spec(self, **kw):
        return {"task_id": kw["task_id"]}

    def run(self, *, prep, spec, allow_roles=False):
        self.events.append(f"run(allow_roles={allow_roles})")
        class _Outcome:
            exit_code = 0
            stderr = ""
            stdout = ""
            branch = prep.branch
            workspace = prep.workspace
        return _Outcome

    def commit_changes(self, prep, *, message, **_):
        self.events.append(f"commit_changes({message[:20]}...)")
        return "abcd1234"  # pretend we committed

    def rewire_origin_to_github(self, prep, **_):
        self.events.append("rewire_origin_to_github")
        return "https://github.com/owner/sandbox-repo.git"

    def push_branch(self, prep, remote="origin"):
        self.events.append(f"push_branch({prep.branch})")
        return True


class SandboxGithub:
    GitHubError = GitHubError

    def __init__(self):
        self.create_calls = []
        self.merge_calls = []
        self.checks_calls = []

    def create_draft_pr(self, *, repo, branch, title, body, base="main",
                         label=None, workspace=None):
        self.create_calls.append({"repo": repo, "branch": branch, "title": title})
        n = 200 + len(self.create_calls)
        return PullRequest(
            repo=repo, number=n,
            url=f"https://github.com/{repo}/pull/{n}",
            branch=branch, title=title, state="draft", raw={},
        )

    def merge_pr(self, *, repo, number, method="squash", delete_branch=True,
                  body="", auto=False, admin=False):
        self.merge_calls.append({"repo": repo, "number": number, "method": method,
                                  "auto": auto, "admin": admin})
        return True

    def mark_ready(self, repo, number):
        return True

    def pr_checks(self, repo, number):
        self.checks_calls.append((repo, number))
        return []


def _all_pass(inp):
    r = normalize_response("gemini", {
        "verdict": "PASS", "confidence": 0.95, "summary": "ok",
        "blocking_issues": [], "non_blocking_issues": [],
        "evidence_gaps": [], "recommended_next_action": "merge",
    })
    return ValidationOutcome(
        ok_for_auto_merge=True, needs_human=False,
        final_verdict="PASS", results=[r, r], reasons=["all PASS"],
    )


# ── tests ──────────────────────────────────────────────────────────


def test_sandbox_e2e_auto_merge_happy_path(fake_repo: Path) -> None:
    """Full pipeline: start_task → ruling=AUTO_MERGE → push → PR →
    gh merge → task=merged."""
    _seed(fake_repo, auto_merge=True)
    _flip_writes_on()
    runner = SandboxRunner()
    gh = SandboxGithub()

    enqueue("start_task", repo_id="sandbox",
            payload={"repo_id": "sandbox", "goal": "add reverse() function"})
    res = run_once(runner=runner, validator_fn=_all_pass, github=gh,
                    notify_fn=lambda **_: None, poll_ci=False)

    # 1. command handled
    assert res.handled and res.status == "succeeded", res.result
    # 2. SandboxRunner went through every phase in order
    assert "prepare_workspace" in runner.events
    assert any(e.startswith("run(") for e in runner.events)
    assert any(e.startswith("commit_changes") for e in runner.events)
    assert "rewire_origin_to_github" in runner.events
    assert any(e.startswith("push_branch") for e in runner.events)
    # 3. PR was created + merged via gh
    assert gh.create_calls, "PR should be created"
    assert gh.merge_calls, "PR should be merged"
    assert gh.merge_calls[0]["method"] == "squash"
    # 4. DB state shows the full record
    with open_db() as conn:
        task = conn.execute(
            "SELECT status FROM tasks WHERE id = ?", (res.result["task_id"],),
        ).fetchone()
        assert task["status"] == "merged"
        pr = conn.execute(
            "SELECT state, approval_state, merged_at FROM prs WHERE repo_id = ?",
            ("sandbox",),
        ).fetchone()
        assert pr["state"] == "merged"
        assert pr["merged_at"]
        validators = conn.execute(
            "SELECT COUNT(*) AS c FROM validator_results"
        ).fetchone()
        assert validators["c"] == 2
        risk = conn.execute(
            "SELECT score, level FROM risk_scores WHERE task_id = ?",
            (res.result["task_id"],),
        ).fetchone()
        assert risk["level"] == "low"


def test_sandbox_e2e_waiting_approval_path(fake_repo: Path) -> None:
    """Same pipeline but repo.auto_merge.enabled=False → ruling=
    WAITING_APPROVAL → PR created, NOT merged, task awaits approval."""
    _seed(fake_repo, auto_merge=False)
    _flip_writes_on()
    runner = SandboxRunner()
    gh = SandboxGithub()
    enqueue("start_task", repo_id="sandbox",
            payload={"repo_id": "sandbox", "goal": "needs human"})
    res = run_once(runner=runner, validator_fn=_all_pass, github=gh,
                    notify_fn=lambda **_: None, poll_ci=False)
    assert res.handled
    assert res.result["ruling"]["decision"] == "waiting_approval"
    assert gh.create_calls
    assert gh.merge_calls == []
    with open_db() as conn:
        task = conn.execute(
            "SELECT status FROM tasks WHERE id = ?", (res.result["task_id"],),
        ).fetchone()
        assert task["status"] == "waiting_for_approval"
        pr = conn.execute(
            "SELECT approval_state FROM prs WHERE repo_id = ?",
            ("sandbox",),
        ).fetchone()
        assert pr["approval_state"] == "required"


def test_sandbox_e2e_paused_repo_defers(fake_repo: Path) -> None:
    """A paused repo skips start_task entirely — no workspace, no PR."""
    _seed(fake_repo)
    system_state.pause_repo("sandbox")
    runner = SandboxRunner()
    gh = SandboxGithub()
    enqueue("start_task", repo_id="sandbox",
            payload={"repo_id": "sandbox", "goal": "should not run"})
    res = run_once(runner=runner, validator_fn=_all_pass, github=gh,
                    notify_fn=lambda **_: None, poll_ci=False)
    assert res.handled
    assert res.result.get("deferred") is True
    assert runner.events == []
    assert gh.create_calls == []
