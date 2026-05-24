"""Load ``.env`` files into ``os.environ`` and expose a deterministic
RuntimeConfig view (BR-002).

Why this exists: launchd's ``EnvironmentVariables`` only takes a static
list. The operator's API keys may live in any of:

  - ``~/.claude-code-247/.env``  (user, default)
  - ``<project_root>/.env``      (a repo's own .env file)
  - ``<cwd>/.env``                (operator's current working dir)

Without this loader chain, ``com.claude247.dispatcher`` runs without
``GEMINI_API_KEY`` / ``OPENAI_API_KEY`` and silently falls back to
mock validators — the original M18-P4/BR-002 finding.

Format: plain ``KEY=value`` lines (the same shape ``set -a; source x;
set +a`` understands). Comment lines start with ``#``. Values are NOT
shell-expanded — we deliberately keep this simple.

Idempotent: re-running does not overwrite already-set vars (matching
the spirit of "explicit shell env wins"). Among .env files in a chain,
the FIRST file to set a key wins.

Locked precedence (mirrored in tests/unit/test_env_loader_precedence.py):

  Config YAML:
    1. explicit ``--config`` path
    2. ``$CLAUDE247_CONFIG``
    3. ``~/.claude-code-247/config.yaml``
    4. ``<cwd>/.claude247/config.yaml``

  Env values:
    already-set os.environ > project-root .env > CWD .env >
    ``~/.claude-code-247/.env``
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
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
        # M20-P1b: bash-style `export VAR=value` is common in secrets.env
        # files because they're often sourced from a shell. Strip the
        # `export` prefix so the resulting key is a real env var name.
        if key.startswith("export "):
            key = key[len("export "):].strip()
        value = value.strip().strip('"').strip("'")
        if not key:
            continue
        if not override and key in os.environ:
            continue
        os.environ[key] = value
        applied[key] = "(applied)"  # never echo the value
    return applied


def discover_env_paths(
    *,
    cwd: Path | None = None,
    project_root: Path | None = None,
) -> list[Path]:
    """Return the ordered list of env files to apply.

    Order = first wins among files (highest priority first):

      1. ``<project_root>/.env`` if project_root is known
      2. ``<cwd>/.env`` if different from project_root
      3. ``<user_config_dir>/.env`` (``~/.claude-code-247/.env`` by default)
      4. ``<user_config_dir>/secrets.env``  — M20-P1b

    The ``secrets.env`` slot exists because the operator may keep a
    dedicated secret store separate from their general .env (commonly
    `chmod 600`, never shared). Before this slot existed, launchd-
    spawned daemons couldn't see those keys because there's no shell
    wrapper between launchd and the dispatcher process.

    Missing files are still returned in the list; ``load_chain`` skips
    them gracefully. Returning every candidate (existing or not) makes
    debug surfacing (doctor) honest about "where we looked".
    """
    from orchestrator.config import default_config_dir

    out: list[Path] = []
    if project_root is not None:
        out.append(Path(project_root).expanduser() / ".env")
    if cwd is not None:
        cwd_env = Path(cwd).expanduser() / ".env"
        if cwd_env not in out:
            out.append(cwd_env)
    user_dir = default_config_dir()
    out.append(user_dir / ".env")
    out.append(user_dir / "secrets.env")
    return out


def load_chain(paths: list[Path | str | None] | None = None, *,
                override: bool = False) -> dict[str, str]:
    """Load a sequence of .env files in order. Among the chain, the
    first file to set a key wins (because ``load`` skips already-set
    vars when ``override`` is False). Missing files are skipped.
    """
    if not paths:
        return {}
    all_applied: dict[str, str] = {}
    for raw in paths:
        if raw is None:
            continue
        try:
            applied = load(raw, override=override)
        except OSError:
            continue
        for k, v in applied.items():
            all_applied.setdefault(k, v)
    return all_applied


@dataclass(frozen=True)
class RuntimeConfig:
    """The resolved view of how this process loaded its configuration.

    Surface for doctor + diagnostics. Never echoes secret values — only
    presence flags. Field names are stable; downstream tools key off
    them.
    """
    cwd: Path
    config_source: Path | None
    config_source_kind: str  # "explicit" | "env" | "user" | "repo" | "none"
    env_files_loaded: list[Path]
    env_keys_applied: list[str]  # only the NAMES, never the values
    worker_mode: str
    allow_api_fallback: bool
    anthropic_api_key_present: bool
    gemini_api_key_present: bool
    openai_api_key_present: bool
    github_token_present: bool
    repo_registry_path: Path
    database_path: Path
    log_dir: Path
    dashboard_port: int

    def to_dict(self) -> dict:
        return {
            "cwd": str(self.cwd),
            "config_source": str(self.config_source) if self.config_source else None,
            "config_source_kind": self.config_source_kind,
            "env_files_loaded": [str(p) for p in self.env_files_loaded],
            "env_keys_applied": list(self.env_keys_applied),
            "worker_mode": self.worker_mode,
            "allow_api_fallback": self.allow_api_fallback,
            "anthropic_api_key_present": self.anthropic_api_key_present,
            "gemini_api_key_present": self.gemini_api_key_present,
            "openai_api_key_present": self.openai_api_key_present,
            "github_token_present": self.github_token_present,
            "repo_registry_path": str(self.repo_registry_path),
            "database_path": str(self.database_path),
            "log_dir": str(self.log_dir),
            "dashboard_port": self.dashboard_port,
        }


def load_runtime_config(
    *,
    cwd: Path | None = None,
    explicit_config: Path | None = None,
    project_root: Path | None = None,
    apply_env: bool = True,
) -> RuntimeConfig:
    """Resolve config + .env files for this process and return a
    RuntimeConfig snapshot.

    Side effects when ``apply_env=True`` (default): loads the .env
    chain into ``os.environ`` respecting the "first-wins among files,
    already-set wins absolutely" rule.
    """
    # Local imports to avoid circular dependency with orchestrator.config.
    from orchestrator.config import (
        EXPLICIT_CONFIG_ENV,
        default_config_dir,
        resolve_config_path,
    )

    use_cwd = Path(cwd).expanduser() if cwd is not None else Path.cwd()

    config_path = resolve_config_path(cwd=use_cwd, explicit=explicit_config)
    if explicit_config is not None:
        kind = "explicit"
    elif os.environ.get(EXPLICIT_CONFIG_ENV):
        kind = "env"
    elif config_path and config_path == (default_config_dir() / "config.yaml"):
        kind = "user"
    elif config_path is not None:
        kind = "repo"
    else:
        kind = "none"

    env_paths = discover_env_paths(cwd=use_cwd, project_root=project_root)
    if apply_env:
        applied = load_chain(env_paths)
    else:
        applied = {}

    # Defer to runner.auth to resolve worker_mode + allow_api_fallback so
    # this stays in sync with the M18-P0 logic.
    from runner.auth import allow_api_fallback as _allow_fallback
    from runner.auth import resolve_worker_mode

    from orchestrator.repo_registry import default_repos_path

    try:
        from memory.db import default_db_path
        db_path = default_db_path()
    except Exception:  # pragma: no cover — defensive
        db_path = default_config_dir() / "state" / "claude247.db"

    from orchestrator.config import load_config
    cfg = load_config()

    return RuntimeConfig(
        cwd=use_cwd,
        config_source=config_path,
        config_source_kind=kind,
        env_files_loaded=[p for p in env_paths if p.exists()],
        env_keys_applied=sorted(applied.keys()),
        worker_mode=resolve_worker_mode(),
        allow_api_fallback=_allow_fallback(),
        anthropic_api_key_present=bool(os.environ.get("ANTHROPIC_API_KEY")),
        gemini_api_key_present=bool(os.environ.get("GEMINI_API_KEY")),
        openai_api_key_present=bool(os.environ.get("OPENAI_API_KEY")),
        github_token_present=bool(
            os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
        ),
        repo_registry_path=default_repos_path(),
        database_path=Path(db_path),
        log_dir=default_config_dir() / "logs",
        dashboard_port=cfg.dashboard_port,
    )
