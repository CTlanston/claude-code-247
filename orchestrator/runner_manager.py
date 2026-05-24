"""Runner manager — spawn workers, manage workspaces.

Two backends:

  * ``local`` — runs ``python -m runner.worker`` as a subprocess on the
    host. No isolation, but works without Docker and is the test default.
  * ``docker`` — runs the runner image with the workspace bind-mounted
    and ``~/.claude`` mounted read-only so the local Claude Code session
    carries through.

The workspace is a sibling clone of the registered repo, created with
``git clone --shared`` so it's cheap and disposable. We never operate on
the user's working copy of the repo directly. A branch is created with
the pattern ``agent/<repo_id>/<task_id>/<short_slug>``.

Push to remote and PR creation go through ``allow_remote_writes`` — when
the flag is false the manager preps the branch and stops; the operator
can push manually if desired.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from orchestrator.config import load_config
from orchestrator.ids import utc_now_iso
from orchestrator.repo_registry import RepoEntry, load_registry

WORKSPACE_ROOT_ENV = "CLAUDE247_WORKSPACE_ROOT"


def default_workspace_root() -> Path:
    if env := os.environ.get(WORKSPACE_ROOT_ENV):
        return Path(env).expanduser()
    return Path.home() / ".claude-code-247" / "workspaces"


def _slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return (s or "task")[:40]


def branch_for(task_id: str, repo_id: str, goal: str) -> str:
    return f"agent/{repo_id}/{task_id}/{_slugify(goal)}"


@dataclass
class WorkspacePrep:
    workspace: Path
    repo_id: str
    task_id: str
    branch: str
    used_existing: bool


@dataclass
class WorkerOutcome:
    exit_code: int
    workspace: Path
    branch: str
    evidence_dir: Path
    stdout: str
    stderr: str
    duration_s: float
    pushed: bool = False
    pr_url: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


class RunnerManagerError(RuntimeError):
    pass


class RunnerManager:
    def __init__(
        self,
        *,
        backend: str = "local",
        workspace_root: Path | None = None,
        registry: list[RepoEntry] | None = None,
        docker_image: str = "claude-code-247/runner:latest",
        runner_command: list[str] | None = None,
    ) -> None:
        if backend not in ("local", "docker"):
            raise ValueError(f"unknown backend {backend!r}")
        self.backend = backend
        self.workspace_root = workspace_root or default_workspace_root()
        self.workspace_root.mkdir(parents=True, exist_ok=True)
        self._registry = registry
        self.docker_image = docker_image
        # Override for tests; default invokes the in-repo runner module.
        self.runner_command = runner_command or [sys.executable, "-m", "runner.worker"]

    # ── registry ────────────────────────────────────────────────────

    def registry(self) -> list[RepoEntry]:
        if self._registry is None:
            self._registry = load_registry()
        return self._registry

    def get_repo(self, repo_id: str) -> RepoEntry:
        for e in self.registry():
            if e.id == repo_id:
                return e
        raise RunnerManagerError(f"unknown repo_id {repo_id!r}")

    # ── workspace ───────────────────────────────────────────────────

    def prepare_workspace(self, *, task_id: str, repo_id: str, goal: str) -> WorkspacePrep:
        repo = self.get_repo(repo_id)
        local_path = Path(repo.local_path).expanduser()
        if not (local_path / ".git").exists():
            raise RunnerManagerError(
                f"repo {repo_id!r} local_path {local_path} is not a git repo"
            )

        ws = self.workspace_root / task_id
        used_existing = ws.exists()
        if not used_existing:
            ws.mkdir(parents=True)
            # --shared: cheap clone that uses the source repo's objects.
            # We're a single Mac so this is safe; for remote-host runners
            # we'd switch to --depth=1 + a fresh fetch.
            self._git(["clone", "--shared", str(local_path), str(ws)], cwd=None)

        branch = branch_for(task_id, repo_id, goal)
        # Create branch from default_branch.
        self._git(["checkout", "-B", branch, repo.default_branch], cwd=ws)
        return WorkspacePrep(
            workspace=ws, repo_id=repo_id, task_id=task_id,
            branch=branch, used_existing=used_existing,
        )

    def cleanup_workspace(self, task_id: str) -> None:
        ws = self.workspace_root / task_id
        if ws.exists():
            shutil.rmtree(ws)

    # ── worker invocation ───────────────────────────────────────────

    def build_task_spec(
        self,
        *,
        task_id: str,
        repo: RepoEntry,
        goal: str,
        branch: str,
    ) -> dict[str, Any]:
        raw = repo.raw or {}
        commands = {
            "test": raw.get("test_commands") or [],
            "lint": raw.get("lint_commands") or [],
            "build": raw.get("build_commands") or [],
        }
        return {
            "task_id": task_id,
            "repo_id": repo.id,
            "goal": goal,
            "branch": branch,
            "allowed_paths": raw.get("allowed_paths") or ["**"],
            "forbidden_paths": raw.get("forbidden_paths") or [],
            "commands": commands,
            "spec_built_at": utc_now_iso(),
        }

    def run(
        self,
        *,
        prep: WorkspacePrep,
        spec: dict[str, Any],
        env: dict[str, str] | None = None,
        timeout: float | None = 1800.0,
        allow_roles: bool = False,
    ) -> WorkerOutcome:
        env_merged = dict(os.environ)
        if env:
            env_merged.update(env)
        if self.backend == "local":
            return self._run_local(prep, spec, env_merged, timeout, allow_roles)
        return self._run_docker(prep, spec, env_merged, timeout, allow_roles)

    def _run_local(
        self,
        prep: WorkspacePrep,
        spec: dict[str, Any],
        env: dict[str, str],
        timeout: float | None,
        allow_roles: bool,
    ) -> WorkerOutcome:
        argv = list(self.runner_command) + ["--workspace", str(prep.workspace)]
        if allow_roles:
            argv.append("--allow-roles")
        argv.extend(["--task-spec", "-"])
        import time
        t0 = time.time()
        proc = subprocess.run(
            argv, input=json.dumps(spec), text=True,
            capture_output=True, env=env, timeout=timeout,
        )
        return WorkerOutcome(
            exit_code=proc.returncode,
            workspace=prep.workspace,
            branch=prep.branch,
            evidence_dir=prep.workspace / ".evidence",
            stdout=proc.stdout,
            stderr=proc.stderr,
            duration_s=round(time.time() - t0, 3),
            metadata={"backend": "local"},
        )

    def _run_docker(
        self,
        prep: WorkspacePrep,
        spec: dict[str, Any],
        env: dict[str, str],
        timeout: float | None,
        allow_roles: bool,
    ) -> WorkerOutcome:
        claude_home = Path.home() / ".claude"
        if not claude_home.exists():
            raise RunnerManagerError(
                "~/.claude not present; cannot bind-mount local Claude Code auth"
            )
        cmd = [
            "docker", "run", "--rm",
            "-v", f"{prep.workspace}:/workspace",
            "-v", f"{claude_home}:/home/runner/.claude:ro",
            "--workdir", "/workspace",
            self.docker_image,
            "--workspace", "/workspace",
            "--task-spec", "-",
        ]
        if allow_roles:
            cmd.insert(-1, "--allow-roles")
        import time
        t0 = time.time()
        proc = subprocess.run(
            cmd, input=json.dumps(spec), text=True,
            capture_output=True, env=env, timeout=timeout,
        )
        return WorkerOutcome(
            exit_code=proc.returncode,
            workspace=prep.workspace,
            branch=prep.branch,
            evidence_dir=prep.workspace / ".evidence",
            stdout=proc.stdout,
            stderr=proc.stderr,
            duration_s=round(time.time() - t0, 3),
            metadata={"backend": "docker", "image": self.docker_image},
        )

    # ── post-worker: commit + push + PR ─────────────────────────────

    def commit_changes(
        self,
        prep: WorkspacePrep,
        *,
        message: str,
        author_name: str = "claude-code-247",
        author_email: str = "noreply@claude-code-247.local",
    ) -> str | None:
        """Stage and commit any non-evidence changes. Returns the SHA, or
        None if there was nothing to commit."""
        # Stage everything except .evidence/ to keep the PR clean.
        self._git(["add", "--", ":!.evidence/"], cwd=prep.workspace)
        status = self._git(
            ["status", "--porcelain"], cwd=prep.workspace, capture=True
        ).strip()
        if not status:
            return None
        env = {
            **os.environ,
            "GIT_AUTHOR_NAME": author_name,
            "GIT_AUTHOR_EMAIL": author_email,
            "GIT_COMMITTER_NAME": author_name,
            "GIT_COMMITTER_EMAIL": author_email,
        }
        self._git(["commit", "-m", message], cwd=prep.workspace, env=env)
        sha = self._git(["rev-parse", "HEAD"], cwd=prep.workspace, capture=True).strip()
        return sha

    def push_branch(self, prep: WorkspacePrep, remote: str = "origin") -> bool:
        """Push the branch to remote IF the global safety gate is open."""
        cfg = load_config()
        if not cfg.allow_remote_writes:
            return False
        self._git(["push", "-u", remote, prep.branch], cwd=prep.workspace)
        return True

    # ── internals ───────────────────────────────────────────────────

    def _git(
        self,
        argv: list[str],
        *,
        cwd: Path | None,
        env: dict[str, str] | None = None,
        capture: bool = False,
    ) -> str:
        full = ["git"] + (["-C", str(cwd)] if cwd else []) + argv
        proc = subprocess.run(
            full, capture_output=True, text=True, env=env or os.environ.copy(),
        )
        if proc.returncode != 0:
            raise RunnerManagerError(
                f"git {' '.join(argv)}: rc={proc.returncode}\n{proc.stderr.strip()}"
            )
        return proc.stdout if capture else ""
