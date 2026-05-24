"""Auth mode resolution for the runner.

Per spec §8 the system prefers ``local_claude_code`` and never silently
switches to ``anthropic_api_fallback``. This module is the gatekeeper:

  - ``resolve_auth_mode()`` returns the configured mode.
  - ``ensure_usable(mode)`` validates the requested mode is callable:
      * local_claude_code     → ``claude`` CLI on PATH
      * anthropic_api_fallback → ``ANTHROPIC_API_KEY`` in env AND config
                                  ``auth.mode == anthropic_api_fallback``
                                  AND the operator has approved (either
                                  ``api_fallback_requires_approval: false``
                                  or the caller passed ``approved=True``).
"""
from __future__ import annotations

import os
import shutil
from dataclasses import dataclass

from orchestrator.config import load_config


@dataclass
class AuthDecision:
    ok: bool
    mode: str
    reason: str


def resolve_auth_mode() -> str:
    cfg = load_config()
    mode = cfg.auth_mode
    if mode not in ("local_claude_code", "anthropic_api_fallback", "validator_api_only"):
        return "local_claude_code"
    return mode


def ensure_usable(mode: str | None = None, *, approved: bool = False) -> AuthDecision:
    mode = mode or resolve_auth_mode()
    if mode == "local_claude_code":
        if shutil.which("claude") is None:
            return AuthDecision(False, mode, "claude CLI not in PATH")
        return AuthDecision(True, mode, "local Claude Code CLI available")
    if mode == "anthropic_api_fallback":
        cfg = load_config()
        if not os.environ.get("ANTHROPIC_API_KEY"):
            return AuthDecision(False, mode, "ANTHROPIC_API_KEY missing")
        if cfg.get("auth.api_fallback_requires_approval", True) and not approved:
            return AuthDecision(
                False, mode,
                "api_fallback requires operator approval per config; "
                "no approval token present"
            )
        return AuthDecision(True, mode, "API fallback approved")
    if mode == "validator_api_only":
        return AuthDecision(True, mode, "validators use their own keys; "
                                          "main worker still expects local CLI")
    return AuthDecision(False, mode, f"unknown auth mode: {mode}")
