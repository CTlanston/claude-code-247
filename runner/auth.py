"""Auth mode resolution for the runner.

M18-P0: explicit ``worker_mode`` (config.auth.worker_mode) supersedes
the legacy ``mode`` field. The choice is:

  local_claude_code — invoke the local Claude Code CLI and let it pick
                      its credential (keychain OAuth, subscription, or
                      apiKeyHelper). When this mode is selected, the
                      runner strips ``ANTHROPIC_API_KEY`` from the
                      subprocess env so the CLI cannot silently use it
                      and thereby switch to API billing.

  anthropic_api     — explicitly use ``ANTHROPIC_API_KEY``. Per-call
                      cost is reported and warned per
                      ``auth.show_cost_warnings``.

Fallback from local to API is OFF by default (``allow_api_fallback:
false``). When it's on, the orchestrator still requires
``require_explicit_api_fallback: false`` AND an ``approved=True`` flag
on the call to actually do it. Belt and suspenders so a surprise cost
never happens silently.

Public surface:
  resolve_worker_mode() -> str
  resolve_auth_mode() -> str  (legacy alias)
  ensure_usable(mode?, approved?) -> AuthDecision
  effective_env(env?, *, worker_mode?) -> dict[str, str]
    — scrub or keep ANTHROPIC_API_KEY based on worker_mode

Doctor (M18-P0 §1) consumes both ``resolve_worker_mode`` and
``ensure_usable`` so its output reports which mode is configured AND
whether it's usable.
"""
from __future__ import annotations

import os
import shutil
from dataclasses import dataclass

from orchestrator.config import load_config

WORKER_MODES = ("local_claude_code", "anthropic_api")
# Legacy modes kept callable for the old ensure_usable API.
LEGACY_MODES = ("local_claude_code", "anthropic_api_fallback",
                 "validator_api_only")


@dataclass
class AuthDecision:
    ok: bool
    mode: str
    reason: str


def resolve_worker_mode() -> str:
    """Return the configured worker_mode. Default local_claude_code.

    Reads ``auth.worker_mode`` first; falls back to translating the
    legacy ``auth.mode`` field for back-compat (``anthropic_api_fallback``
    → ``anthropic_api``; everything else → ``local_claude_code``).
    """
    cfg = load_config()
    explicit = cfg.get("auth.worker_mode")
    if explicit in WORKER_MODES:
        return explicit
    legacy = cfg.get("auth.mode") or "local_claude_code"
    if legacy == "anthropic_api_fallback":
        return "anthropic_api"
    return "local_claude_code"


def resolve_auth_mode() -> str:
    """Legacy alias used by older callers / tests."""
    cfg = load_config()
    mode = cfg.auth_mode
    if mode not in LEGACY_MODES:
        return "local_claude_code"
    return mode


def effective_env(env: dict[str, str] | None = None, *,
                   worker_mode: str | None = None) -> dict[str, str]:
    """Return the env the runner should hand to ``claude --print``.

    In local_claude_code mode we strip ANTHROPIC_API_KEY (and
    ANTHROPIC_BASE_URL, which would also redirect via API) so the CLI
    falls back to its keychain credential. In anthropic_api mode we
    pass the env through unchanged.
    """
    out = dict(env if env is not None else os.environ)
    mode = worker_mode or resolve_worker_mode()
    if mode == "local_claude_code":
        out.pop("ANTHROPIC_API_KEY", None)
        out.pop("ANTHROPIC_BASE_URL", None)
    return out


def ensure_usable(mode: str | None = None, *,
                   approved: bool = False) -> AuthDecision:
    """Validate that the requested mode is actually callable.

    Honors the new worker_mode config when ``mode`` is None — defaults
    to the modern mode names (``anthropic_api``, not the legacy
    ``anthropic_api_fallback``). The legacy name is still callable
    when passed explicitly so old tests / callers keep working.
    """
    if mode is None:
        mode = resolve_worker_mode()
    cfg = load_config()
    if mode == "local_claude_code":
        if shutil.which("claude") is None:
            return AuthDecision(False, mode,
                                 "claude CLI not in PATH; "
                                 "install with `npm install -g @anthropic-ai/claude-code`")
        return AuthDecision(True, mode, "local Claude Code CLI available")
    if mode in ("anthropic_api", "anthropic_api_fallback"):
        if not os.environ.get("ANTHROPIC_API_KEY"):
            return AuthDecision(False, mode, "ANTHROPIC_API_KEY missing")
        # Legacy api_fallback gate.
        if mode == "anthropic_api_fallback" and cfg.get(
            "auth.api_fallback_requires_approval", True
        ) and not approved:
            return AuthDecision(
                False, mode,
                "api_fallback requires operator approval per config; "
                "no approval token present"
            )
        return AuthDecision(True, mode, "ANTHROPIC_API_KEY available")
    if mode == "validator_api_only":
        return AuthDecision(True, mode, "validators use their own keys; "
                                          "main worker still expects local CLI")
    return AuthDecision(False, mode, f"unknown auth mode: {mode}")


def allow_api_fallback() -> bool:
    """Whether silent fallback from local→api is permitted."""
    cfg = load_config()
    return bool(cfg.get("auth.allow_api_fallback", False))


def cost_warnings_enabled() -> bool:
    cfg = load_config()
    return bool(cfg.get("auth.show_cost_warnings", True))
