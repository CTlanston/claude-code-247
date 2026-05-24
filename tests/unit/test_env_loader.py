from __future__ import annotations

import os
from pathlib import Path

import pytest

from orchestrator import env_loader


def test_load_returns_empty_when_missing(tmp_path: Path) -> None:
    assert env_loader.load(tmp_path / "nope.env") == {}


def test_load_applies_keys_to_os_environ(tmp_path: Path,
                                          monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("FOO_TEST_KEY", raising=False)
    p = tmp_path / "x.env"
    p.write_text("FOO_TEST_KEY=hello\n# comment\nBAR=42\n")
    applied = env_loader.load(p)
    assert "FOO_TEST_KEY" in applied
    assert os.environ["FOO_TEST_KEY"] == "hello"
    assert os.environ["BAR"] == "42"


def test_load_skips_existing_unless_override(tmp_path: Path,
                                              monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ALREADY_SET", "from-shell")
    p = tmp_path / "x.env"
    p.write_text("ALREADY_SET=from-file\n")
    env_loader.load(p)
    assert os.environ["ALREADY_SET"] == "from-shell"
    env_loader.load(p, override=True)
    assert os.environ["ALREADY_SET"] == "from-file"


def test_load_strips_quotes(tmp_path: Path,
                             monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("QUOTED", raising=False)
    p = tmp_path / "x.env"
    p.write_text('QUOTED="value with spaces"\n')
    env_loader.load(p)
    assert os.environ["QUOTED"] == "value with spaces"


def test_load_never_echoes_values(tmp_path: Path,
                                   monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SECRET_KEY_X", raising=False)
    p = tmp_path / "x.env"
    p.write_text("SECRET_KEY_X=supersecret\n")
    applied = env_loader.load(p)
    # The returned dict carries variable NAMES (and a marker), never values.
    assert applied["SECRET_KEY_X"] == "(applied)"
    assert "supersecret" not in str(applied)


def test_default_env_path_uses_env_override(monkeypatch: pytest.MonkeyPatch,
                                              tmp_path: Path) -> None:
    target = tmp_path / "custom.env"
    monkeypatch.setenv("CLAUDE247_ENV_FILE", str(target))
    assert env_loader.default_env_path() == target


def test_m20_p1b_bash_export_prefix_is_stripped(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """secrets.env files are often written `export VAR=value` because
    they're sourced from a shell. Before this fix, the loader would
    set ``os.environ['export VAR'] = value`` (the literal "export "
    prefix kept as part of the key name — a useless garbage env var).
    Now the prefix is stripped so the result is a real env var."""
    monkeypatch.delenv("M20_BASH_EXPORT_PROBE", raising=False)
    monkeypatch.delenv("export M20_BASH_EXPORT_PROBE", raising=False)
    p = tmp_path / "secrets.env"
    p.write_text("export M20_BASH_EXPORT_PROBE=sk-test\n")
    applied = env_loader.load(p)
    assert "M20_BASH_EXPORT_PROBE" in applied
    assert os.environ["M20_BASH_EXPORT_PROBE"] == "sk-test"
    assert "export M20_BASH_EXPORT_PROBE" not in os.environ
