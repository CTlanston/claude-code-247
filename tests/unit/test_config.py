from __future__ import annotations

import os
from pathlib import Path

import yaml

from orchestrator.config import deep_merge, default_config_dir, load_config


def test_default_config_dir_uses_env() -> None:
    p = default_config_dir()
    assert p == Path(os.environ["CLAUDE247_CONFIG_DIR"])


def test_load_config_returns_defaults_when_no_user_override() -> None:
    cfg = load_config()
    # default.yaml ships with allow_remote_writes: false, auth.mode: local_claude_code
    assert cfg.allow_remote_writes is False
    assert cfg.auth_mode == "local_claude_code"
    assert cfg.dashboard_port == 8423
    assert cfg.get("validators.gemini.enabled") is True


def test_user_override_overrides_default(tmp_path: Path) -> None:
    cfg_dir = Path(os.environ["CLAUDE247_CONFIG_DIR"])
    (cfg_dir / "config.yaml").write_text(yaml.safe_dump({
        "system": {"allow_remote_writes": True, "dashboard_port": 9001},
        "auth": {"mode": "anthropic_api_fallback"},
    }))
    cfg = load_config()
    assert cfg.allow_remote_writes is True
    assert cfg.dashboard_port == 9001
    assert cfg.auth_mode == "anthropic_api_fallback"
    # untouched defaults still present
    assert cfg.get("validators.gemini.enabled") is True


def test_deep_merge_does_not_mutate_inputs() -> None:
    base = {"a": {"x": 1, "y": 2}, "b": 3}
    over = {"a": {"y": 99, "z": 100}}
    merged = deep_merge(base, over)
    assert merged == {"a": {"x": 1, "y": 99, "z": 100}, "b": 3}
    # originals untouched
    assert base == {"a": {"x": 1, "y": 2}, "b": 3}
    assert over == {"a": {"y": 99, "z": 100}}


def test_deep_merge_replaces_lists_rather_than_appends() -> None:
    base = {"forbidden_paths": ["a", "b"]}
    over = {"forbidden_paths": ["c"]}
    merged = deep_merge(base, over)
    assert merged == {"forbidden_paths": ["c"]}
