"""BR-002 — .env files in CWD and project root are picked up.

The original bug from M18-P4: a developer with OPENAI_API_KEY in
``<cwd>/.env`` ran the worker and the validator still used the mock
because env_loader only looked at ``~/.claude-code-247/.env``.
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest

from orchestrator import env_loader


def test_dotenv_in_cwd_is_discovered(tmp_path: Path,
                                       monkeypatch: pytest.MonkeyPatch) -> None:
    cwd = tmp_path / "work"
    cwd.mkdir()
    (cwd / ".env").write_text("CWD_DOTENV_PROBE=1\n")
    paths = env_loader.discover_env_paths(cwd=cwd, project_root=None)
    str_paths = [str(p) for p in paths]
    assert str(cwd / ".env") in str_paths


def test_dotenv_in_project_root_is_discovered(tmp_path: Path) -> None:
    project = tmp_path / "proj"
    (project / "src").mkdir(parents=True)
    (project / ".env").write_text("PROJ_DOTENV_PROBE=1\n")
    cwd = project / "src"
    paths = env_loader.discover_env_paths(cwd=cwd, project_root=project)
    str_paths = [str(p) for p in paths]
    assert str(project / ".env") in str_paths


def test_user_dotenv_still_loaded(tmp_path: Path,
                                    monkeypatch: pytest.MonkeyPatch) -> None:
    user = tmp_path / "user"
    user.mkdir()
    (user / ".env").write_text("USER_DOTENV_PROBE=1\n")
    monkeypatch.setenv("CLAUDE247_CONFIG_DIR", str(user))
    paths = env_loader.discover_env_paths(cwd=tmp_path)
    str_paths = [str(p) for p in paths]
    assert str(user / ".env") in str_paths


def test_dotenv_load_chain_picks_up_cwd(tmp_path: Path,
                                          monkeypatch: pytest.MonkeyPatch) -> None:
    cwd = tmp_path / "work"
    cwd.mkdir()
    (cwd / ".env").write_text("BR002_TEST_KEY=from-cwd\n")
    monkeypatch.delenv("BR002_TEST_KEY", raising=False)

    paths = env_loader.discover_env_paths(cwd=cwd, project_root=None)
    env_loader.load_chain(paths)

    assert os.environ["BR002_TEST_KEY"] == "from-cwd"


def test_launchd_style_empty_shell_still_resolves_user_config(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When launchd starts dispatcher, shell PATH is minimal and no .env
    is in CWD (CWD is typically $HOME). The user config must still load.
    """
    user = tmp_path / "user"
    user.mkdir()
    cfg = user / "config.yaml"
    cfg.write_text("system: {allow_remote_writes: true}\n")
    monkeypatch.setenv("CLAUDE247_CONFIG_DIR", str(user))
    monkeypatch.delenv("CLAUDE247_CONFIG", raising=False)
    # Simulate launchd CWD = HOME (no project)
    rc = env_loader.load_runtime_config(cwd=tmp_path, explicit_config=None)
    assert rc.config_source == cfg
    assert rc.allow_api_fallback is False


def test_running_from_repo_cwd_still_loads_global_config(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """If a managed repo CWD has no .claude247/config.yaml, the global
    user config still resolves — we don't fail-fast on a repo-local
    miss.
    """
    user = tmp_path / "user"
    user.mkdir()
    cfg = user / "config.yaml"
    cfg.write_text("system: {}\n")
    repo = tmp_path / "managed-repo"
    repo.mkdir()
    monkeypatch.setenv("CLAUDE247_CONFIG_DIR", str(user))
    monkeypatch.delenv("CLAUDE247_CONFIG", raising=False)
    rc = env_loader.load_runtime_config(cwd=repo, explicit_config=None)
    assert rc.config_source == cfg


def test_anthropic_key_in_env_does_not_force_api_fallback(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """M18-P0 invariant re-verified in BR-002 path: even with
    ANTHROPIC_API_KEY in env (e.g., from a .env file we just loaded),
    worker_mode stays local_claude_code unless the operator explicitly
    set auth.worker_mode = anthropic_api in config.
    """
    user = tmp_path / "user"
    user.mkdir()
    (user / "config.yaml").write_text("system: {}\n")  # no auth section -> default
    monkeypatch.setenv("CLAUDE247_CONFIG_DIR", str(user))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")

    rc = env_loader.load_runtime_config(cwd=tmp_path, explicit_config=None)
    assert rc.worker_mode == "local_claude_code"
    assert rc.allow_api_fallback is False
    assert rc.anthropic_api_key_present is True
