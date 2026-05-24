"""Load ``~/.claude-code-247/.env`` into ``os.environ`` at process start.

Why this exists: launchd's ``EnvironmentVariables`` only takes a static
list. The operator's API keys live in ``~/.claude-code-247/.env`` (or a
sibling project's .env they want to share). Without this loader,
``com.claude247.dispatcher`` runs without ``GEMINI_API_KEY`` /
``OPENAI_API_KEY`` and silently falls back to mock validators.

Format: plain ``KEY=value`` lines (the same shape ``set -a; source x;
set +a`` understands). Comment lines start with ``#``. Values are NOT
shell-expanded — we deliberately keep this simple.

Always idempotent: re-running does not overwrite already-set vars,
matching the spirit of "explicit env wins". A line ``KEY=value`` with
``KEY`` already in ``os.environ`` is skipped.
"""
from __future__ import annotations

import os
from pathlib import Path

DEFAULT_ENV_PATH_ENV = "CLAUDE247_ENV_FILE"


def default_env_path() -> Path:
    if env := os.environ.get(DEFAULT_ENV_PATH_ENV):
        return Path(env).expanduser()
    return Path.home() / ".claude-code-247" / ".env"


def load(path: Path | str | None = None, *,
          override: bool = False) -> dict[str, str]:
    """Load KEY=value pairs into os.environ. Returns the names that
    were actually applied (so callers can log without exposing values)."""
    p = Path(path).expanduser() if path else default_env_path()
    applied: dict[str, str] = {}
    if not p.exists():
        return applied
    try:
        body = p.read_text(encoding="utf-8")
    except OSError:
        return applied
    for raw in body.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if not key:
            continue
        if not override and key in os.environ:
            continue
        os.environ[key] = value
        applied[key] = "(applied)"  # never echo the value
    return applied
