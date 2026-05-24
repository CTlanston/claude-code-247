"""M16: a task that fails its merge gate writes a line into the repo's
.agent/FAILURES.md AND seeds a vector-store failure item — no need to
wait for `memory compile --daily`."""
from __future__ import annotations

import os
from pathlib import Path

import yaml

from memory.db import init_db, open_db
from memory.repo_memory import AgentMemory
from orchestrator.command_queue import enqueue
from orchestrator.dispatcher import run_once
from orchestrator.github_client import GitHubError, PullRequest
from orchestrator.repo_registry import parse_registry, sync_to_db
from validator.judge_contract import normalize_response
from validator.validation_policy import ValidationOutcome


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
        ws = Path(os.environ["CLAUDE247_WORKSPACE_ROOT"]) / task_id
        ws.mkdir(parents=True, exist_ok=True)
        (ws / ".git").mkdir(exist_ok=True)
        ev = ws / ".evidence"
        ev.mkdir(exist_ok=True)
        (ev / "contract.md").write_text("# c\n")
        (ev / "diff_summary.md").write_text("")
        (ev / "file_manifest.json").write_text("[]")
        # Failing tests → BLOCKED ruling
        (ev / "test_results.json").write_text(
            '[{"cmd":"pytest","exit":1,"stdout_tail":"FAILED",'
            '"stderr_tail":"","duration_s":0.05}]'
        )
        (ev / "lint_results.json").write_text("[]")
        (ev / "build_results.json").write_text("[]")
        return _Prep(ws, f"agent/{repo_id}/{task_id}/g", repo_id, task_id)

    def get_repo(self, repo_id):
        from orchestrator.repo_registry import load_registry
        return [r for r in load_registry() if r.id == repo_id][0]

    def build_task_spec(self, **kw):
        return {"task_id": kw["task_id"]}

    def run(self, *, prep, spec, allow_roles=False):
        class _Out:
            exit_code = 1
            stderr = ""
            stdout = ""
            branch = prep.branch
            workspace = prep.workspace
        return _Out

    def commit_changes(self, prep, *, message, **_): return None
    def rewire_origin_to_github(self, prep, **_): return ""
    def push_branch(self, prep, remote="origin"): return False


def _all_pass(inp):
    """Validators PASS but tests fail → BLOCKED ruling."""
    r = normalize_response("g", {"verdict": "PASS", "confidence": 0.9,
                                   "summary": "", "blocking_issues": [],
                                   "non_blocking_issues": [], "evidence_gaps": [],
                                   "recommended_next_action": ""})
    return ValidationOutcome(
        ok_for_auto_merge=True, needs_human=False,
        final_verdict="PASS", results=[r, r], reasons=["all PASS"],
    )


def test_failed_task_appends_to_repo_failures_md(fake_repo: Path) -> None:
    repos_path = Path(os.environ["CLAUDE247_REPOS_FILE"])
    repos_path.write_text(yaml.safe_dump({"repos": [{
        "id": "demo", "github_owner": "o", "github_repo": "r",
        "local_path": str(fake_repo),
        "forbidden_paths": [".env"],
        "auto_merge": {"enabled": True, "max_risk_score": 30,
                        "max_changed_lines": 300},
    }]}))
    init_db()
    sync_to_db(parse_registry(repos_path.read_text()))

    enqueue("start_task", repo_id="demo",
            payload={"repo_id": "demo", "goal": "will block"})
    res = run_once(runner=_Runner(), validator_fn=_all_pass,
                    notify_fn=lambda **_: None, poll_ci=False)
    assert res.handled
    assert res.result["ruling"]["decision"] == "blocked"

    # .agent/FAILURES.md exists and mentions the task
    mem = AgentMemory(repo_path=fake_repo)
    body = mem.read("FAILURES")
    assert body, "expected .agent/FAILURES.md to be written"
    assert res.result["task_id"] in body
    assert "blocked" in body.lower() or "risk" in body.lower()

    # memory_items also has a failure row for the repo
    with open_db() as conn:
        n = conn.execute(
            "SELECT COUNT(*) AS c FROM memory_items WHERE repo_id = ? AND item_type = 'failure'",
            ("demo",),
        ).fetchone()["c"]
        assert n >= 1
