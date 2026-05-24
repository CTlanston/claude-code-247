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


def test_m20_p1b_secrets_env_in_user_config_dir_is_discovered(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """M20-P1b: launchd-spawned daemons run without a shell wrapper,
    so an OPENAI_API_KEY stashed in a chmod-600 `secrets.env` next to
    the user `.env` was previously invisible. discover_env_paths now
    probes both files."""
    user = tmp_path / "user"
    user.mkdir()
    (user / ".env").write_text("DOTENV_KEY=from-dotenv\n")
    (user / "secrets.env").write_text("SECRETS_KEY=from-secrets\n")
    monkeypatch.setenv("CLAUDE247_CONFIG_DIR", str(user))

    paths = env_loader.discover_env_paths(cwd=tmp_path)
    str_paths = [str(p) for p in paths]
    assert str(user / ".env") in str_paths
    assert str(user / "secrets.env") in str_paths


def test_m20_p1b_secrets_env_loads_keys_not_in_dotenv(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When .env doesn't define a key but secrets.env does, the chain
    surfaces it. This is the OPENAI_API_KEY case from the M20 Phase 1
    gate (`.env` had GEMINI_API_KEY only; `secrets.env` had OPENAI_API_KEY).
    """
    user = tmp_path / "user"
    user.mkdir()
    (user / ".env").write_text("DOTENV_ONLY_KEY=dotenv\n")
    (user / "secrets.env").write_text("SECRETS_ONLY_KEY=secrets\n")
    monkeypatch.setenv("CLAUDE247_CONFIG_DIR", str(user))
    monkeypatch.delenv("DOTENV_ONLY_KEY", raising=False)
    monkeypatch.delenv("SECRETS_ONLY_KEY", raising=False)

    paths = env_loader.discover_env_paths(cwd=tmp_path)
    env_loader.load_chain(paths)
    assert os.environ["DOTENV_ONLY_KEY"] == "dotenv"
    assert os.environ["SECRETS_ONLY_KEY"] == "secrets"


def test_m20_p1b_dotenv_wins_over_secrets_env_on_collision(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """If both files define the same key, .env wins because it comes
    first in the chain (first-wins semantics of load_chain with
    override=False). secrets.env is a fallback, not an override."""
    user = tmp_path / "user"
    user.mkdir()
    (user / ".env").write_text("COLLIDE_KEY=from-dotenv\n")
    (user / "secrets.env").write_text("COLLIDE_KEY=from-secrets\n")
    monkeypatch.setenv("CLAUDE247_CONFIG_DIR", str(user))
    monkeypatch.delenv("COLLIDE_KEY", raising=False)

    paths = env_loader.discover_env_paths(cwd=tmp_path)
    env_loader.load_chain(paths)
    assert os.environ["COLLIDE_KEY"] == "from-dotenv"


def test_m20_p1b_missing_secrets_env_does_not_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Most operators won't have a secrets.env. Discovery still returns
    it as a candidate (for transparency), and load_chain just skips it."""
    user = tmp_path / "user"
    user.mkdir()
    # only .env exists; no secrets.env
    (user / ".env").write_text("ONLY_DOTENV=1\n")
    monkeypatch.setenv("CLAUDE247_CONFIG_DIR", str(user))
    monkeypatch.delenv("ONLY_DOTENV", raising=False)

    paths = env_loader.discover_env_paths(cwd=tmp_path)
    # Returns 3 paths: cwd/.env, user/.env, user/secrets.env
    # (whether each exists or not — load_chain handles missing)
    assert any(p.name == "secrets.env" for p in paths)
    env_loader.load_chain(paths)
    # Doesn't raise; the dotenv-only key loaded fine
    assert os.environ["ONLY_DOTENV"] == "1"


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
