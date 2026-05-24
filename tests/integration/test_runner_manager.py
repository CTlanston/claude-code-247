from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import yaml

from memory.db import init_db
from orchestrator.config import load_config
from orchestrator.repo_registry import parse_registry, sync_to_db
from orchestrator.runner_manager import (
    RunnerManager,
    RunnerManagerError,
    branch_for,
    default_workspace_root,
)


# Use sys.executable + -m pytest so the test doesn't depend on the parent
# shell's PATH including the venv (which is often the case on macOS).
PYTEST_CMD = f"{sys.executable} -m pytest -q"


def _seed_registry_for(fake_repo: Path) -> None:
    repos_path = Path(os.environ["CLAUDE247_REPOS_FILE"])
    repos_path.write_text(yaml.safe_dump({"repos": [{
        "id": "demo",
        "github_owner": "owner",
        "github_repo": "demo-repo",
        "local_path": str(fake_repo),
        "default_branch": "main",
        "forbidden_paths": [".env"],
        "test_commands": [PYTEST_CMD],
        "lint_commands": [],
        "build_commands": [],
    }]}))
    init_db()
    sync_to_db(parse_registry(repos_path.read_text()))


def test_branch_for_slugifies_goal() -> None:
    assert branch_for("task_X", "demo", "Add Auth Middleware!!") == \
        "agent/demo/task_X/add-auth-middleware"


def test_branch_for_handles_empty_goal() -> None:
    assert branch_for("task_X", "demo", "") == "agent/demo/task_X/task"


def test_prepare_workspace_clones_and_creates_branch(fake_repo: Path) -> None:
    _seed_registry_for(fake_repo)
    rm = RunnerManager(backend="local")
    prep = rm.prepare_workspace(task_id="task_001", repo_id="demo", goal="add greet")
    assert prep.workspace.exists()
    assert (prep.workspace / ".git").exists()
    assert prep.branch == "agent/demo/task_001/add-greet"
    # current branch matches
    import subprocess
    head = subprocess.check_output(
        ["git", "-C", str(prep.workspace), "branch", "--show-current"], text=True
    ).strip()
    assert head == prep.branch


def test_run_local_executes_test_commands_and_emits_evidence(fake_repo: Path) -> None:
    _seed_registry_for(fake_repo)
    rm = RunnerManager(backend="local")
    prep = rm.prepare_workspace(task_id="task_002", repo_id="demo", goal="evidence")
    spec = rm.build_task_spec(
        task_id="task_002", repo=rm.get_repo("demo"),
        goal="evidence", branch=prep.branch,
    )
    outcome = rm.run(prep=prep, spec=spec)
    assert outcome.exit_code == 0, outcome.stderr
    ev = prep.workspace / ".evidence"
    assert (ev / "contract.md").exists()
    assert (ev / "worker_done.md").exists()
    assert (ev / "test_results.json").exists()
    assert (ev / "diff_summary.md").exists()
    assert (ev / "file_manifest.json").exists()
    tr = json.loads((ev / "test_results.json").read_text())
    assert tr and tr[0]["exit"] == 0


def test_run_local_surfaces_failing_test(fake_repo: Path) -> None:
    # Replace tests with a failing one.
    (fake_repo / "tests" / "test_lib.py").write_text(
        "def test_break(): assert False\n"
    )
    import subprocess
    subprocess.run(["git", "-C", str(fake_repo), "add", "-A"], check=True)
    subprocess.run(
        ["git", "-C", str(fake_repo), "commit", "-m", "break", "--quiet"], check=True,
        env={**os.environ,
             "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t",
             "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"},
    )

    _seed_registry_for(fake_repo)
    rm = RunnerManager(backend="local")
    prep = rm.prepare_workspace(task_id="task_003", repo_id="demo", goal="bad")
    spec = rm.build_task_spec(task_id="task_003", repo=rm.get_repo("demo"),
                              goal="bad", branch=prep.branch)
    outcome = rm.run(prep=prep, spec=spec)
    assert outcome.exit_code != 0


def test_commit_changes_returns_none_when_empty(fake_repo: Path) -> None:
    _seed_registry_for(fake_repo)
    rm = RunnerManager(backend="local")
    prep = rm.prepare_workspace(task_id="task_004", repo_id="demo", goal="noop")
    sha = rm.commit_changes(prep, message="empty")
    assert sha is None


def test_commit_changes_creates_commit_when_dirty(fake_repo: Path) -> None:
    _seed_registry_for(fake_repo)
    rm = RunnerManager(backend="local")
    prep = rm.prepare_workspace(task_id="task_005", repo_id="demo", goal="dirty")
    (prep.workspace / "src" / "lib.py").write_text("def add(a, b):\n    return a + b\n\ndef sub(a, b):\n    return a - b\n")
    sha = rm.commit_changes(prep, message="add sub")
    assert sha and len(sha) >= 7


def test_push_branch_is_blocked_by_default(fake_repo: Path) -> None:
    _seed_registry_for(fake_repo)
    rm = RunnerManager(backend="local")
    prep = rm.prepare_workspace(task_id="task_006", repo_id="demo", goal="push?")
    # No remote configured, but allow_remote_writes is False so we shouldn't try.
    pushed = rm.push_branch(prep)
    assert pushed is False


def test_push_branch_attempts_when_flag_set(fake_repo: Path, tmp_path: Path) -> None:
    # Provide a bare remote so push can succeed
    bare = tmp_path / "bare.git"
    import subprocess
    subprocess.run(["git", "init", "--bare", "-q", str(bare)], check=True)
    subprocess.run(["git", "-C", str(fake_repo), "remote", "remove", "origin"],
                   stderr=subprocess.DEVNULL)
    subprocess.run(["git", "-C", str(fake_repo), "remote", "add", "origin", str(bare)], check=True)

    _seed_registry_for(fake_repo)

    # Flip the allow_remote_writes flag.
    cfg_dir = Path(os.environ["CLAUDE247_CONFIG_DIR"])
    (cfg_dir / "config.yaml").write_text(yaml.safe_dump({
        "system": {"allow_remote_writes": True},
    }))
    assert load_config().allow_remote_writes is True

    rm = RunnerManager(backend="local")
    prep = rm.prepare_workspace(task_id="task_007", repo_id="demo", goal="push")
    (prep.workspace / "src" / "lib.py").write_text(
        "def add(a, b):\n    return a + b\n\ndef mul(a, b):\n    return a * b\n"
    )
    rm.commit_changes(prep, message="add mul")
    # cloned workspace inherits the source's remote? With --shared the remote
    # url is the source repo itself, not bare. Add a remote pointing to bare.
    subprocess.run(["git", "-C", str(prep.workspace), "remote", "remove", "origin"],
                   stderr=subprocess.DEVNULL)
    subprocess.run(["git", "-C", str(prep.workspace), "remote", "add", "origin", str(bare)], check=True)
    pushed = rm.push_branch(prep)
    assert pushed is True
    # Bare repo should now have the branch
    refs = subprocess.check_output(["git", "-C", str(bare), "for-each-ref",
                                    "--format=%(refname:short)"], text=True)
    assert prep.branch in refs


def test_unknown_repo_raises() -> None:
    rm = RunnerManager(backend="local", registry=[])
    import pytest
    with pytest.raises(RunnerManagerError):
        rm.get_repo("nope")


def test_default_workspace_root_uses_env() -> None:
    p = default_workspace_root()
    assert p == Path(os.environ["CLAUDE247_WORKSPACE_ROOT"])
