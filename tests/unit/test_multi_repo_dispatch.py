"""M16: multi-repo dispatch isolation.

Prove that tasks/PRs/state for two distinct repos in the registry
don't leak into each other. The directive explicitly calls this out
as a non-negotiable from day one.
"""
from __future__ import annotations

import os
from pathlib import Path

import yaml

from memory.db import init_db, open_db
from orchestrator import system_state
from orchestrator.command_queue import enqueue
from orchestrator.dispatcher import run_once
from orchestrator.ids import make_id, utc_now_iso
from orchestrator.repo_registry import load_registry, parse_registry, sync_to_db


def _seed_two_repos(fake_repo: Path) -> None:
    """Both repos share the same on-disk fake_repo for cheapness; the
    registry IDs differ so dispatcher must route by id, not by path."""
    repos_path = Path(os.environ["CLAUDE247_REPOS_FILE"])
    repos_path.write_text(yaml.safe_dump({"repos": [
        {"id": "alpha", "github_owner": "o", "github_repo": "alpha-repo",
         "local_path": str(fake_repo), "forbidden_paths": [".env"],
         "enabled": True},
        {"id": "beta", "github_owner": "o", "github_repo": "beta-repo",
         "local_path": str(fake_repo), "forbidden_paths": [".env"],
         "enabled": True},
    ]}))
    init_db()
    sync_to_db(parse_registry(repos_path.read_text()))


def test_registry_holds_two_repos(fake_repo: Path) -> None:
    _seed_two_repos(fake_repo)
    entries = load_registry()
    ids = {e.id for e in entries}
    assert ids == {"alpha", "beta"}


def test_pause_repo_alpha_only_defers_alpha(fake_repo: Path) -> None:
    """A pause on `alpha` must not affect `beta` work."""
    _seed_two_repos(fake_repo)
    system_state.pause_repo("alpha")
    assert system_state.is_repo_paused("alpha")
    assert system_state.is_repo_paused("beta") is False


def test_start_task_routes_by_repo_id(fake_repo: Path) -> None:
    """Two start_task commands enqueued for different repos produce two
    distinct tasks, each tied to the right repo."""
    _seed_two_repos(fake_repo)

    # Mock runner that records the task it saw
    seen: list[tuple[str, str]] = []

    class _Prep:
        def __init__(self, ws, branch, repo_id, task_id):
            self.workspace = ws
            self.branch = branch
            self.repo_id_ = repo_id
            self.task_id_ = task_id
            self.used_existing = False

    class _Runner:
        backend = "local"

        def prepare_workspace(self, *, task_id, repo_id, goal):
            seen.append((repo_id, task_id))
            ws = Path(os.environ["CLAUDE247_WORKSPACE_ROOT"]) / task_id
            ws.mkdir(parents=True, exist_ok=True)
            (ws / ".git").mkdir(exist_ok=True)
            ev = ws / ".evidence"
            ev.mkdir(exist_ok=True)
            (ev / "contract.md").write_text("# c\n")
            (ev / "diff_summary.md").write_text("")
            (ev / "file_manifest.json").write_text("[]")
            (ev / "test_results.json").write_text("[]")
            (ev / "lint_results.json").write_text("[]")
            (ev / "build_results.json").write_text("[]")
            return _Prep(ws, f"agent/{repo_id}/{task_id}/g", repo_id, task_id)

        def get_repo(self, repo_id):
            return [r for r in load_registry() if r.id == repo_id][0]

        def build_task_spec(self, **kw):
            return {"task_id": kw["task_id"]}

        def run(self, *, prep, spec, allow_roles=False):
            class _O:
                exit_code = 0
                stderr = ""
                stdout = ""
                branch = prep.branch
                workspace = prep.workspace
            return _O

        def commit_changes(self, prep, *, message, **_): return None
        def rewire_origin_to_github(self, prep, **_): return ""
        def push_branch(self, prep, remote="origin"): return False

    enqueue("start_task", repo_id="alpha",
            payload={"repo_id": "alpha", "goal": "alpha goal"})
    enqueue("start_task", repo_id="beta",
            payload={"repo_id": "beta", "goal": "beta goal"})

    # Run twice — dispatcher processes one command per tick.
    r1 = run_once(runner=_Runner(), validator_fn=_pass_validator(),
                   notify_fn=lambda **_: None, poll_ci=False)
    r2 = run_once(runner=_Runner(), validator_fn=_pass_validator(),
                   notify_fn=lambda **_: None, poll_ci=False)
    assert r1.handled and r2.handled
    assert r1.command_type == "start_task"
    assert r2.command_type == "start_task"

    # Two distinct tasks, each tied to its repo_id
    with open_db() as conn:
        rows = list(conn.execute(
            "SELECT repo_id, goal FROM tasks ORDER BY created_at ASC"
        ))
    assert len(rows) == 2
    assert {(r["repo_id"], r["goal"]) for r in rows} == {
        ("alpha", "alpha goal"),
        ("beta", "beta goal"),
    }

    # Runner was invoked once per repo with the matching repo_id
    assert {repo for repo, _task in seen} == {"alpha", "beta"}


def _pass_validator():
    from validator.judge_contract import normalize_response
    from validator.validation_policy import ValidationOutcome
    def _fn(inp):
        r = normalize_response("g", {"verdict": "PASS", "confidence": 0.9,
                                       "summary": "", "blocking_issues": [],
                                       "non_blocking_issues": [], "evidence_gaps": [],
                                       "recommended_next_action": ""})
        return ValidationOutcome(
            ok_for_auto_merge=True, needs_human=False,
            final_verdict="PASS", results=[r, r], reasons=["all PASS"],
        )
    return _fn
