"""M18-P0: worker_mode honesty + no silent fallback."""
from __future__ import annotations

import os
import shutil
from pathlib import Path

import pytest
import yaml

from runner.auth import (
    allow_api_fallback,
    effective_env,
    ensure_usable,
    resolve_worker_mode,
)


def _write_config(**overrides) -> None:
    cfg_dir = Path(os.environ["CLAUDE247_CONFIG_DIR"])
    (cfg_dir / "config.yaml").write_text(yaml.safe_dump({"auth": overrides}))


def test_default_worker_mode_is_local_claude_code() -> None:
    assert resolve_worker_mode() == "local_claude_code"


def test_explicit_worker_mode_anthropic_api_is_honored() -> None:
    _write_config(worker_mode="anthropic_api")
    assert resolve_worker_mode() == "anthropic_api"


def test_legacy_mode_translation_when_worker_mode_explicitly_null() -> None:
    """When a user explicitly nulls worker_mode (e.g. they're on an
    older config), the legacy ``auth.mode`` field controls the
    translation. Setting worker_mode to YAML null bypasses the
    default.yaml's default value via deep_merge."""
    cfg_dir = Path(os.environ["CLAUDE247_CONFIG_DIR"])
    (cfg_dir / "config.yaml").write_text(
        "auth:\n  worker_mode: null\n  mode: anthropic_api_fallback\n"
    )
    assert resolve_worker_mode() == "anthropic_api"


def test_effective_env_strips_anthropic_key_in_local_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test-redacted")
    monkeypatch.setenv("ANTHROPIC_BASE_URL", "https://x")
    out = effective_env(worker_mode="local_claude_code")
    # Stripped — silent API fallback eliminated
    assert "ANTHROPIC_API_KEY" not in out
    assert "ANTHROPIC_BASE_URL" not in out


def test_effective_env_keeps_anthropic_key_in_api_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test-redacted")
    out = effective_env(worker_mode="anthropic_api")
    assert out.get("ANTHROPIC_API_KEY") == "sk-test-redacted"


def test_local_mode_unusable_when_claude_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("PATH", "/nowhere")
    d = ensure_usable("local_claude_code")
    assert d.ok is False
    assert "claude CLI" in d.reason
    # Reason includes install hint
    assert "@anthropic-ai/claude-code" in d.reason


def test_local_mode_usable_when_claude_in_path() -> None:
    if shutil.which("claude") is None:
        pytest.skip("claude CLI not installed on this host")
    d = ensure_usable("local_claude_code")
    assert d.ok is True


def test_anthropic_api_mode_requires_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    d = ensure_usable("anthropic_api")
    assert d.ok is False
    assert "ANTHROPIC_API_KEY" in d.reason


def test_anthropic_api_mode_usable_when_key_present(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    d = ensure_usable("anthropic_api")
    assert d.ok is True


def test_allow_api_fallback_default_false() -> None:
    assert allow_api_fallback() is False


def test_allow_api_fallback_when_config_says_true() -> None:
    _write_config(allow_api_fallback=True)
    assert allow_api_fallback() is True


def test_anthropic_api_fallback_legacy_still_requires_approval(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The legacy api_fallback gate must still apply when callers
    explicitly use the legacy mode name."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    _write_config(mode="anthropic_api_fallback")
    d = ensure_usable("anthropic_api_fallback")
    assert d.ok is False
    assert "approval" in d.reason.lower()
