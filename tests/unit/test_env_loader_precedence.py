"""BR-002 — env_loader resolves config + .env files in deterministic order.

Locked precedence (documented in M19_BETA_STABILIZATION_REPORT.md):

  Config YAML:
    1. explicit --config path
    2. $CLAUDE247_CONFIG env var
    3. ~/.claude-code-247/config.yaml
    4. <cwd>/.claude247/config.yaml

  Env values:
    Already-set os.environ wins over every .env file. Among .env files
    the order is project-root .env > CWD .env > ~/.claude-code-247/.env.
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest

from orchestrator import env_loader
from orchestrator.config import resolve_config_path


def test_explicit_config_path_beats_all(tmp_path: Path,
                                         monkeypatch: pytest.MonkeyPatch) -> None:
    explicit = tmp_path / "explicit.yaml"
    explicit.write_text("system: {}\n")
    env_var = tmp_path / "env.yaml"
    env_var.write_text("system: {}\n")
    monkeypatch.setenv("CLAUDE247_CONFIG", str(env_var))

    path = resolve_config_path(explicit=explicit)
    assert path == explicit


def test_claude247_config_env_beats_user_config(tmp_path: Path,
                                                  monkeypatch: pytest.MonkeyPatch) -> None:
    user_cfg = tmp_path / "user.yaml"
    user_cfg.write_text("system: {}\n")
    env_cfg = tmp_path / "env.yaml"
    env_cfg.write_text("system: {}\n")
    monkeypatch.setenv("CLAUDE247_CONFIG", str(env_cfg))
    monkeypatch.setenv("CLAUDE247_CONFIG_DIR", str(tmp_path))  # user_cfg lives here

    path = resolve_config_path()
    assert path == env_cfg


def test_user_config_beats_repo_local(tmp_path: Path,
                                         monkeypatch: pytest.MonkeyPatch) -> None:
    user_dir = tmp_path / "user"
    user_dir.mkdir()
    user_cfg = user_dir / "config.yaml"
    user_cfg.write_text("system: {}\n")
    repo_dir = tmp_path / "repo"
    (repo_dir / ".claude247").mkdir(parents=True)
    (repo_dir / ".claude247" / "config.yaml").write_text("system: {}\n")
    monkeypatch.setenv("CLAUDE247_CONFIG_DIR", str(user_dir))
    monkeypatch.delenv("CLAUDE247_CONFIG", raising=False)

    path = resolve_config_path(cwd=repo_dir)
    assert path == user_cfg


def test_repo_local_used_when_no_user_config(tmp_path: Path,
                                                monkeypatch: pytest.MonkeyPatch) -> None:
    empty_user = tmp_path / "user"
    empty_user.mkdir()  # no config.yaml inside
    repo_dir = tmp_path / "repo"
    (repo_dir / ".claude247").mkdir(parents=True)
    repo_cfg = repo_dir / ".claude247" / "config.yaml"
    repo_cfg.write_text("system: {}\n")
    monkeypatch.setenv("CLAUDE247_CONFIG_DIR", str(empty_user))
    monkeypatch.delenv("CLAUDE247_CONFIG", raising=False)

    path = resolve_config_path(cwd=repo_dir)
    assert path == repo_cfg


def test_explicit_env_var_beats_any_dotenv(tmp_path: Path,
                                              monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MY_TEST_KEY", "shell-explicit")
    env_file = tmp_path / ".env"
    env_file.write_text("MY_TEST_KEY=from-file\n")
    env_loader.load(env_file)
    assert os.environ["MY_TEST_KEY"] == "shell-explicit"


def test_load_chain_first_file_wins_among_dotenvs(tmp_path: Path,
                                                     monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CHAIN_KEY", raising=False)
    a = tmp_path / "a.env"
    a.write_text("CHAIN_KEY=from-a\n")
    b = tmp_path / "b.env"
    b.write_text("CHAIN_KEY=from-b\n")
    env_loader.load_chain([a, b])
    assert os.environ["CHAIN_KEY"] == "from-a"


def test_load_chain_skips_missing_paths(tmp_path: Path,
                                          monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OK_KEY", raising=False)
    real = tmp_path / "x.env"
    real.write_text("OK_KEY=ok\n")
    # Should not raise on missing path; still loads existing one
    env_loader.load_chain([tmp_path / "nope.env", real])
    assert os.environ["OK_KEY"] == "ok"
