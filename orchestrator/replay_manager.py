"""Failure-replay packaging.

Per spec §15, every failed task is replayable. ``build_replay_package``
gathers everything an operator (or a fresh runner) needs to reconstruct
the failure:

  original_goal
  repo config snapshot
  contract / plan / worker_done / diff_summary / file_manifest
  test/lint/build results
  validator outputs (from validator_results)
  reviewer report (.evidence/review.md)
  risk score (most recent)
  full timeline (task_events)
  branch + commit shas (best-effort from local workspace)
  environment metadata (python version, claude CLI version, OS)

The package is a single JSON document written next to the workspace
(or wherever the operator asks). Three modes drive what happens next:

  --dry-run       just emit the package
  --explain-only  emit + print a short summary
  --repair        emit + re-run runner.worker with --allow-roles
"""
from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from memory.db import open_db
from orchestrator.config import load_config, default_config_dir
from orchestrator.ids import utc_now_iso
from orchestrator.repo_registry import load_registry
from orchestrator.runner_manager import RunnerManager, default_workspace_root


@dataclass
class ReplayPackage:
    task_id: str
    repo_id: str | None
    goal: str | None
    package: dict[str, Any]
    path: Path

    def to_dict(self) -> dict[str, Any]:
        return self.package


def build_replay_package(
    task_id: str,
    *,
    out_dir: Path | None = None,
    db_path: Path | str | None = None,
) -> ReplayPackage:
    """Build the replay JSON for ``task_id`` and write it to disk."""
    with open_db(db_path) as conn:
        task = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if task is None:
            raise ValueError(f"unknown task {task_id!r}")
        events = list(conn.execute(
            "SELECT * FROM task_events WHERE task_id = ? "
            "ORDER BY created_at ASC, rowid ASC", (task_id,),
        ).fetchall())
        runs = list(conn.execute(
            "SELECT * FROM runs WHERE task_id = ? ORDER BY started_at ASC",
            (task_id,),
        ).fetchall())
        validators = list(conn.execute(
            "SELECT * FROM validator_results WHERE task_id = ? "
            "ORDER BY created_at ASC", (task_id,),
        ).fetchall())
        risk = conn.execute(
            "SELECT * FROM risk_scores WHERE task_id = ? "
            "ORDER BY created_at DESC LIMIT 1", (task_id,),
        ).fetchone()
        pr = conn.execute(
            "SELECT * FROM prs WHERE task_id = ? "
            "ORDER BY created_at DESC LIMIT 1", (task_id,),
        ).fetchone()

    repo_row = None
    if task["repo_id"]:
        for r in load_registry():
            if r.id == task["repo_id"]:
                repo_row = r
                break

    workspace = default_workspace_root() / task_id
    evidence: dict[str, Any] = {}
    if workspace.exists():
        ev_dir = workspace / ".evidence"
        if ev_dir.exists():
            for name in ("contract.md", "plan.md", "worker_done.md",
                          "diff_summary.md", "review.md", "summary.json"):
                p = ev_dir / name
                if p.exists():
                    evidence[name] = p.read_text(encoding="utf-8")
            for name in ("test_results.json", "lint_results.json",
                          "build_results.json", "file_manifest.json"):
                p = ev_dir / name
                if p.exists():
                    try:
                        evidence[name] = json.loads(p.read_text(encoding="utf-8"))
                    except json.JSONDecodeError:
                        evidence[name] = p.read_text(encoding="utf-8")

    commits: list[str] = []
    if workspace.exists() and (workspace / ".git").exists():
        try:
            out = subprocess.check_output(
                ["git", "-C", str(workspace), "log", "--format=%H %s", "-20"],
                text=True,
            )
            commits = [ln for ln in out.splitlines() if ln.strip()]
        except (subprocess.CalledProcessError, OSError):
            commits = []

    package: dict[str, Any] = {
        "schema_version": 1,
        "generated_at": utc_now_iso(),
        "task": dict(task),
        "events": [dict(e) for e in events],
        "runs": [dict(r) for r in runs],
        "validators": [dict(v) for v in validators],
        "risk": dict(risk) if risk else None,
        "pr": dict(pr) if pr else None,
        "repo_snapshot": repo_row.raw if repo_row else None,
        "workspace": str(workspace) if workspace.exists() else None,
        "evidence": evidence,
        "git_commits": commits,
        "environment": _env_snapshot(),
    }

    out_dir = out_dir or default_config_dir() / "replays"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{task_id}.replay.json"
    out_path.write_text(json.dumps(package, indent=2, default=str), encoding="utf-8")
    return ReplayPackage(
        task_id=task_id,
        repo_id=task["repo_id"],
        goal=task["goal"],
        package=package,
        path=out_path,
    )


def explain(package: ReplayPackage) -> str:
    """Return a short human-readable summary of the replay package."""
    t = package.package.get("task") or {}
    events = package.package.get("events") or []
    last_event = events[-1] if events else None
    validators = package.package.get("validators") or []
    risk = package.package.get("risk")
    lines = [
        f"task     : {package.task_id}",
        f"repo     : {package.repo_id or '(unknown)'}",
        f"goal     : {package.goal or '(unknown)'}",
        f"status   : {t.get('status')}",
        f"branch   : {t.get('branch') or '(none)'}",
    ]
    if last_event:
        lines.append(f"last     : {last_event.get('event_type')} — {last_event.get('message')}")
    if risk:
        lines.append(f"risk     : {risk.get('score')} ({risk.get('level')})")
    for v in validators[-2:]:
        lines.append(f"validator: {v.get('validator')} → {v.get('verdict')}")
    lines.append(f"package  : {package.path}")
    return "\n".join(lines)


def replay_repair(
    package: ReplayPackage,
    *,
    runner: RunnerManager | None = None,
    allow_roles: bool = True,
) -> dict[str, Any]:
    """Re-run the worker against the existing workspace (with role loop on)."""
    runner = runner or RunnerManager(backend="local")
    if not package.repo_id:
        raise ValueError("cannot repair: replay package has no repo_id")
    prep = runner.prepare_workspace(
        task_id=package.task_id,
        repo_id=package.repo_id,
        goal=package.goal or "(replay)",
    )
    repo = runner.get_repo(package.repo_id)
    spec = runner.build_task_spec(
        task_id=package.task_id, repo=repo,
        goal=package.goal or "(replay)", branch=prep.branch,
    )
    outcome = runner.run(prep=prep, spec=spec, allow_roles=allow_roles)
    return {
        "exit_code": outcome.exit_code,
        "branch": outcome.branch,
        "workspace": str(outcome.workspace),
        "stderr_tail": (outcome.stderr or "")[-2000:],
    }


def _env_snapshot() -> dict[str, Any]:
    snap: dict[str, Any] = {
        "python": platform.python_version(),
        "platform": platform.platform(),
    }
    for bin_ in ("git", "gh", "docker", "claude"):
        path = shutil.which(bin_)
        snap[bin_] = path
    return snap
