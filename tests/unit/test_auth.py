from __future__ import annotations

import os
import shutil
from pathlib import Path

import pytest
import yaml

from runner.auth import ensure_usable, resolve_auth_mode


def test_resolve_default_is_local_claude_code() -> None:
    assert resolve_auth_mode() == "local_claude_code"


def test_local_mode_ok_when_claude_in_path() -> None:
    # Skip if claude isn't actually installed on this host.
    if shutil.which("claude") is None:
        pytest.skip("claude CLI not installed")
    d = ensure_usable("local_claude_code")
    assert d.ok
    assert d.mode == "local_claude_code"


def test_local_mode_fails_when_claude_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PATH", "/nowhere")
    d = ensure_usable("local_claude_code")
    assert d.ok is False
    assert "claude CLI" in d.reason


def test_api_fallback_requires_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    cfg_dir = Path(os.environ["CLAUDE247_CONFIG_DIR"])
    (cfg_dir / "config.yaml").write_text(yaml.safe_dump({
        "auth": {"mode": "anthropic_api_fallback"},
    }))
    d = ensure_usable()
    assert d.ok is False
    assert "ANTHROPIC_API_KEY" in d.reason


def test_api_fallback_requires_approval_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    cfg_dir = Path(os.environ["CLAUDE247_CONFIG_DIR"])
    (cfg_dir / "config.yaml").write_text(yaml.safe_dump({
        "auth": {"mode": "anthropic_api_fallback"},
    }))
    d = ensure_usable()
    assert d.ok is False
    assert "approval" in d.reason.lower()


def test_api_fallback_with_approved_flag_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    cfg_dir = Path(os.environ["CLAUDE247_CONFIG_DIR"])
    (cfg_dir / "config.yaml").write_text(yaml.safe_dump({
        "auth": {"mode": "anthropic_api_fallback"},
    }))
    d = ensure_usable(approved=True)
    assert d.ok


def test_api_fallback_when_approval_disabled_in_config(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    cfg_dir = Path(os.environ["CLAUDE247_CONFIG_DIR"])
    (cfg_dir / "config.yaml").write_text(yaml.safe_dump({
        "auth": {"mode": "anthropic_api_fallback",
                 "api_fallback_requires_approval": False},
    }))
    d = ensure_usable()
    assert d.ok
