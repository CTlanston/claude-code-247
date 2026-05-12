"""Git proxy: orchestrator owns the GitHub token; runners push to a local bare
repo; orchestrator mirrors that bare repo to GitHub.

Why: keeps Anthropic key on runners, GitHub token on orchestrator only — neither
process sees the other's secrets. In LOCAL_MODE the "GitHub mirror" step is a
no-op, so the bare repo *is* the remote.

Layout (LOCAL_MODE):
  $LOCAL_GIT_REMOTE         bare repo  (acts as "origin" for runners)
  $LOCAL_GIT_SOURCE         working tree the orchestrator clones from to seed
                            new issue worktrees on first run
  $WORKSPACE_ROOT/issue-N/repo
                            per-issue worktree, branch shadow/issue-N

Layout (production):
  /tmp/git-proxy/<repo>.git bare repo bound to runner network
  push hook in the bare repo triggers orchestrator → mirror to GitHub
"""
from __future__ import annotations

import os
import shutil
import subprocess
import logging
from pathlib import Path
from typing import Optional

log = logging.getLogger("git_proxy")

WORKSPACE_ROOT = Path(os.getenv("WORKSPACE_ROOT", "/tmp/claude-247-workspaces"))


def _git(cwd: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "auto-evo-bot",
        "GIT_AUTHOR_EMAIL": "bot@local",
        "GIT_COMMITTER_NAME": "auto-evo-bot",
        "GIT_COMMITTER_EMAIL": "bot@local",
    }
    return subprocess.run(
        ["git", *args], cwd=cwd, env=env,
        capture_output=True, text=True, check=check,
    )


def _local_remote() -> Path:
    return Path(os.getenv("LOCAL_GIT_REMOTE", "/tmp/auto-evo-playground.git"))


def _local_source() -> Path:
    return Path(os.getenv("LOCAL_GIT_SOURCE", "/tmp/auto-evo-playground"))


def _local_mode() -> bool:
    return os.getenv("LOCAL_MODE", "0") == "1"


def ensure_remote() -> None:
    """In LOCAL_MODE: ensure the bare 'remote' and a seed working tree exist.

    Idempotent. Safe to call every loop iteration."""
    if not _local_mode():
        return

    remote = _local_remote()
    source = _local_source()
    default_branch = os.getenv("GITHUB_DEFAULT_BRANCH", "main")

    if not remote.exists():
        log.info("[git_proxy] initializing local bare remote at %s", remote)
        remote.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "init", "--bare", str(remote)], check=True, capture_output=True)

    if not source.exists():
        log.info("[git_proxy] initializing local source repo at %s", source)
        source.parent.mkdir(parents=True, exist_ok=True)
        source.mkdir()
        _git(source, "init", "-b", default_branch)
        # Seed minimal scaffolding so a real CI matrix isn't immediately broken.
        (source / "README.md").write_text("# auto-evo-playground\n\nLocal-mode test repo.\n")
        (source / "src").mkdir(exist_ok=True)
        (source / "src" / "__init__.py").write_text("")
        (source / "src" / "utils.py").write_text('"""Utility helpers — auto-edited by Claude agents."""\n')
        (source / "tests").mkdir(exist_ok=True)
        (source / "tests" / "__init__.py").write_text("")
        (source / ".gitignore").write_text("__pycache__/\n*.pyc\n")
        _git(source, "add", "-A")
        _git(source, "commit", "-m", "chore: initial scaffold")
        # Wire to bare remote.
        _git(source, "remote", "add", "origin", str(remote), check=False)
        _git(source, "push", "-u", "origin", default_branch)


def prepare_worktree(issue_id: int) -> Path:
    """Clone the source repo into $WORKSPACE_ROOT/issue-N/repo and create branch
    shadow/issue-N. Returns the worktree path."""
    ensure_remote()
    branch = f"{os.getenv('GITHUB_SHADOW_PREFIX','shadow')}/issue-{issue_id}"
    workspace = WORKSPACE_ROOT / f"issue-{issue_id}"
    workspace.mkdir(parents=True, exist_ok=True)
    repo_dir = workspace / "repo"

    if repo_dir.exists():
        # Reuse if already cloned; just make sure we're on the shadow branch and synced.
        try:
            _git(repo_dir, "fetch", "origin")
            _git(repo_dir, "checkout", branch)
        except subprocess.CalledProcessError:
            pass
        return repo_dir

    remote = _local_remote() if _local_mode() else _github_clone_url()
    log.info("[git_proxy] cloning %s -> %s", remote, repo_dir)
    subprocess.run(["git", "clone", str(remote), str(repo_dir)], check=True, capture_output=True)
    base = os.getenv("GITHUB_DEFAULT_BRANCH", "main")
    _git(repo_dir, "checkout", base)

    # Create the shadow branch (or reuse if it exists upstream).
    try:
        _git(repo_dir, "checkout", "-b", branch, f"origin/{branch}")
    except subprocess.CalledProcessError:
        _git(repo_dir, "checkout", "-b", branch)

    return repo_dir


def _github_clone_url() -> str:
    token = os.getenv("GITHUB_TOKEN", "")
    repo = os.getenv("GITHUB_REPO", "")
    if not token or not repo or "PLACEHOLDER" in token:
        raise RuntimeError("GITHUB_TOKEN/GITHUB_REPO not configured for non-LOCAL_MODE clone")
    return f"https://x-access-token:{token}@github.com/{repo}.git"


def mirror_to_github(branch: str) -> None:
    """In production: orchestrator mirrors the shadow branch up to GitHub.
    Runs in the orchestrator process so the GitHub token never touches the runner.
    LOCAL_MODE: no-op.

    Path A (preferred): push from the local bare remote at WORKSPACE_ROOT/.bare.
    Path B (fallback):   push directly from the per-issue worktree's repo dir.
                         Used when the bare remote was never bootstrapped
                         (E2E test 2026-05-11 fail mode: bare repo missing →
                         silent push loss → empty shadow branch on GitHub).
    """
    if _local_mode():
        return
    url = _github_clone_url()
    remote = _local_remote()

    # Path A: bare-remote mirror
    if remote.exists():
        subprocess.run(["git", "--git-dir", str(remote), "push", url, f"+{branch}:{branch}"],
                       check=True, capture_output=True)
        return

    # Path B: push from the worktree directly. The branch name convention is
    # shadow/issue-<N>; we derive N to locate the worktree.
    try:
        issue_id = int(branch.rsplit("-", 1)[-1])
    except ValueError as e:
        raise RuntimeError(f"mirror_to_github: cannot parse issue_id from {branch!r}") from e
    repo_dir = WORKSPACE_ROOT / f"issue-{issue_id}" / "repo"
    if not repo_dir.exists():
        raise RuntimeError(
            f"mirror_to_github: no bare remote at {remote} AND no worktree at {repo_dir}. "
            f"Bootstrap the bare repo (git init --bare) or check WORKSPACE_ROOT.")
    log.info("[git_proxy] bare remote missing, falling back to worktree push from %s", repo_dir)
    subprocess.run(["git", "-C", str(repo_dir), "push", url, f"+{branch}:{branch}"],
                   check=True, capture_output=True)


def cleanup_worktree(issue_id: int) -> None:
    workspace = WORKSPACE_ROOT / f"issue-{issue_id}"
    if workspace.exists():
        shutil.rmtree(workspace, ignore_errors=True)


def commit_log(issue_id: int, base: Optional[str] = None) -> list[dict]:
    """Return [{sha, subject}, ...] for commits on the shadow branch since base."""
    base = base or os.getenv("GITHUB_DEFAULT_BRANCH", "main")
    repo_dir = WORKSPACE_ROOT / f"issue-{issue_id}" / "repo"
    if not repo_dir.exists():
        return []
    try:
        out = _git(repo_dir, "log", f"origin/{base}..HEAD", "--pretty=format:%H%x09%s")
    except subprocess.CalledProcessError:
        return []
    rows = []
    for line in out.stdout.splitlines():
        if "\t" not in line:
            continue
        sha, subject = line.split("\t", 1)
        rows.append({"sha": sha, "subject": subject})
    return rows


def diff_files(issue_id: int, base: Optional[str] = None) -> list[str]:
    base = base or os.getenv("GITHUB_DEFAULT_BRANCH", "main")
    repo_dir = WORKSPACE_ROOT / f"issue-{issue_id}" / "repo"
    if not repo_dir.exists():
        return []
    try:
        out = _git(repo_dir, "diff", "--name-only", f"origin/{base}..HEAD")
    except subprocess.CalledProcessError:
        return []
    return [l for l in out.stdout.splitlines() if l.strip()]
