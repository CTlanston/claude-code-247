"""Config loader for claude-code-247.

Loads the bundled default.yaml + policies.yaml from the ``config/`` package
data, then merges any user overrides from ``~/.claude-code-247/config.yaml``
and ``~/.claude-code-247/policies.yaml`` on top.

The merge is a deep dict merge. Lists are *replaced*, not merged, so the
operator can shorten lists without inheriting items.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

DEFAULT_CONFIG_DIR_ENV = "CLAUDE247_CONFIG_DIR"


def default_config_dir() -> Path:
    if env := os.environ.get(DEFAULT_CONFIG_DIR_ENV):
        return Path(env).expanduser()
    return Path.home() / ".claude-code-247"


def _bundled_yaml(name: str) -> dict[str, Any]:
    """Read a YAML file bundled with the source tree."""
    # repo_root/config/<name>
    root = Path(__file__).resolve().parent.parent
    path = root / "config" / name
    if not path.exists():
        return {}
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


def _user_yaml(name: str) -> dict[str, Any]:
    p = default_config_dir() / name
    if not p.exists():
        return {}
    return yaml.safe_load(p.read_text(encoding="utf-8")) or {}


def deep_merge(base: dict[str, Any], over: dict[str, Any]) -> dict[str, Any]:
    """Deep-merge ``over`` into ``base``. Returns a new dict (no mutation)."""
    out = dict(base)
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = v
    return out


@dataclass(frozen=True)
class Config:
    raw: dict[str, Any]
    policies: dict[str, Any]

    def get(self, dotted_key: str, default: Any = None) -> Any:
        """Look up ``a.b.c`` style keys in the merged config."""
        cur: Any = self.raw
        for part in dotted_key.split("."):
            if not isinstance(cur, dict) or part not in cur:
                return default
            cur = cur[part]
        return cur

    @property
    def allow_remote_writes(self) -> bool:
        return bool(self.get("system.allow_remote_writes", False))

    @property
    def auth_mode(self) -> str:
        return str(self.get("auth.mode", "local_claude_code"))

    @property
    def dashboard_host(self) -> str:
        return str(self.get("system.dashboard_host", "127.0.0.1"))

    @property
    def dashboard_port(self) -> int:
        return int(self.get("system.dashboard_port", 8423))


def load_config() -> Config:
    """Load the merged config + policies."""
    base = _bundled_yaml("default.yaml")
    user = _user_yaml("config.yaml")
    merged = deep_merge(base, user)

    base_pol = _bundled_yaml("policies.yaml")
    user_pol = _user_yaml("policies.yaml")
    merged_pol = deep_merge(base_pol, user_pol)

    return Config(raw=merged, policies=merged_pol)
