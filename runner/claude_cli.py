"""Thin wrapper around the local Claude Code CLI in headless mode.

The CLI is invoked separately for *each* role; we deliberately do NOT use
``--resume``. This guarantees that the Reviewer cannot see the Coder's
conversation context (spec §9.1, §27).

Output is parsed from ``--output-format json`` which returns at minimum::

    {
      "result": "<assistant text>",
      "is_error": false,
      "usage": {"input_tokens": N, "output_tokens": N, ...},
      "total_cost_usd": 0.0123,        // only when API-billed
      "session_id": "...",
      "duration_ms": 1234,
      "num_turns": 1,
      "stop_reason": "end_turn"
    }

Local subscription-mode runs report ``total_cost_usd: null``; the budget
manager counts these as ``local_cc_run_count`` rather than as USD spend
(per spec §8.4 — "never report subscription as $0 cost").
"""
from __future__ import annotations

import json
import os
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

DEFAULT_CLAUDE_BIN = "claude"
DEFAULT_PERMISSION_MODE = "bypassPermissions"
DEFAULT_TIMEOUT_S = 600.0


@dataclass(frozen=True)
class ClaudeInvocation:
    role: str
    user_prompt: str
    system_prompt: str
    allowed_tools: list[str] = field(default_factory=list)
    model: str | None = None
    permission_mode: str = DEFAULT_PERMISSION_MODE
    cwd: Path | None = None
    timeout_s: float = DEFAULT_TIMEOUT_S
    extra_args: list[str] = field(default_factory=list)


@dataclass
class ClaudeResult:
    role: str
    ok: bool
    text: str
    raw: dict[str, Any]
    exit_code: int
    duration_s: float
    auth_mode: str
    cost_usd: float | None
    input_tokens: int
    output_tokens: int
    error: str | None = None


class ClaudeCLIError(RuntimeError):
    pass


def invoke(
    inv: ClaudeInvocation,
    *,
    claude_bin: str = DEFAULT_CLAUDE_BIN,
    env: dict[str, str] | None = None,
    auth_mode: str | None = None,
    worker_mode: str | None = None,
) -> ClaudeResult:
    """Run one headless ``claude --print`` invocation.

    Argv shape:
      claude --print --output-format json --append-system-prompt <SYS>
             --permission-mode <MODE> [--model M] [--allowedTools t1,t2,...]
             [extra args...]

    The user prompt is sent on **stdin**, not as a positional argument.
    ``--allowedTools <tools...>`` is variadic in commander.js (the CLI's
    parser); passing the prompt positionally after it causes commander
    to swallow the prompt as another tool name and crash with 'Input
    must be provided either through stdin or as a prompt argument'.

    M18-P0 auth handling:
    - If ``worker_mode`` is None, it's resolved from config
      (``auth.worker_mode``).
    - When worker_mode = local_claude_code, ANTHROPIC_API_KEY (and
      ANTHROPIC_BASE_URL) are stripped from the subprocess env via
      ``runner.auth.effective_env`` so the CLI is forced onto its
      keychain credential. Eliminates silent API fallback.
    - When worker_mode = anthropic_api, env is passed through.
    - ``auth_mode`` (the reported value on the result) is detected
      from the actual env that was handed to the subprocess, so the
      label never lies about what just happened.
    """
    # Lazy import to avoid a cycle (auth → config → load_config).
    from runner.auth import effective_env, resolve_worker_mode

    argv: list[str] = [claude_bin, "--print", "--output-format", "json",
                       "--append-system-prompt", inv.system_prompt,
                       "--permission-mode", inv.permission_mode]
    if inv.model:
        argv += ["--model", inv.model]
    if inv.allowed_tools:
        argv += ["--allowedTools", ",".join(inv.allowed_tools)]
    argv += list(inv.extra_args)
    # Prompt goes via stdin (see docstring).

    if worker_mode is None:
        try:
            worker_mode = resolve_worker_mode()
        except Exception:  # config unavailable in some unit tests
            worker_mode = ("anthropic_api"
                           if os.environ.get("ANTHROPIC_API_KEY")
                           else "local_claude_code")

    base_env = dict(os.environ)
    if env:
        base_env.update(env)
    full_env = effective_env(base_env, worker_mode=worker_mode)

    if auth_mode is None:
        auth_mode = "anthropic_api" if full_env.get("ANTHROPIC_API_KEY") \
            else "local_claude_code"

    t0 = time.time()
    try:
        proc = subprocess.run(
            argv,
            input=inv.user_prompt,
            cwd=str(inv.cwd) if inv.cwd else None,
            env=full_env,
            capture_output=True,
            text=True,
            timeout=inv.timeout_s,
        )
    except FileNotFoundError as e:
        return ClaudeResult(
            role=inv.role, ok=False, text="", raw={}, exit_code=-1,
            duration_s=time.time() - t0, auth_mode=auth_mode,
            cost_usd=None, input_tokens=0, output_tokens=0,
            error=f"claude CLI not found: {e}",
        )
    except subprocess.TimeoutExpired as e:
        return ClaudeResult(
            role=inv.role, ok=False, text=(e.stdout or "") if isinstance(e.stdout, str) else "",
            raw={}, exit_code=124,
            duration_s=time.time() - t0, auth_mode=auth_mode,
            cost_usd=None, input_tokens=0, output_tokens=0,
            error=f"claude CLI timed out after {inv.timeout_s}s",
        )

    duration = time.time() - t0
    raw: dict[str, Any] = {}
    if proc.stdout:
        try:
            raw = json.loads(proc.stdout)
        except json.JSONDecodeError:
            raw = {"raw_text": proc.stdout[:8000]}
    text = str(raw.get("result") or raw.get("text") or "")
    usage = raw.get("usage") or {}
    return ClaudeResult(
        role=inv.role,
        ok=(proc.returncode == 0 and not raw.get("is_error")),
        text=text,
        raw=raw,
        exit_code=proc.returncode,
        duration_s=round(duration, 3),
        auth_mode=auth_mode,
        cost_usd=raw.get("total_cost_usd"),
        input_tokens=int(usage.get("input_tokens", 0)),
        output_tokens=int(usage.get("output_tokens", 0)),
        error=proc.stderr.strip() if proc.returncode != 0 else None,
    )


def smoke_check(claude_bin: str = DEFAULT_CLAUDE_BIN, timeout: float = 30.0) -> ClaudeResult:
    """Round-trip a trivial prompt to verify the CLI is auth-ready."""
    inv = ClaudeInvocation(
        role="smoke",
        user_prompt="Reply with the single token OK and nothing else.",
        system_prompt="You are a smoke-test responder. Reply with exactly: OK",
        timeout_s=timeout,
    )
    return invoke(inv, claude_bin=claude_bin)
