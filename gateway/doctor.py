"""`claude247 doctor` — environment health check.

Runs a small set of probes and returns both a human-readable report and a
machine-readable JSON payload. Each probe yields a ``Check`` with status =
ok | warn | fail and a short message.

A failed *required* probe means the system cannot function; failed
*optional* probes degrade features (e.g., notifications go to local log
only when ntfy is missing).
"""
from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Callable

from memory.db import default_db_path, init_db, open_db, schema_version
from orchestrator.config import default_config_dir, load_config
from orchestrator.repo_registry import default_repos_path, load_registry


@dataclass
class Check:
    name: str
    status: str                # ok | warn | fail
    required: bool
    message: str
    detail: dict[str, Any] = field(default_factory=dict)


def _which(cmd: str) -> str | None:
    return shutil.which(cmd)


def _run(cmd: list[str], timeout: float = 5.0) -> tuple[int, str, str]:
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return proc.returncode, proc.stdout.strip(), proc.stderr.strip()
    except (FileNotFoundError, OSError, subprocess.TimeoutExpired) as e:
        return -1, "", str(e)


def check_macos() -> Check:
    uname = os.uname()
    ok = uname.sysname == "Darwin"
    return Check(
        name="macOS host",
        status="ok" if ok else "warn",
        required=False,
        message=f"{uname.sysname} {uname.release}",
        detail={"sysname": uname.sysname, "release": uname.release, "machine": uname.machine},
    )


def check_python() -> Check:
    import sys
    major, minor = sys.version_info[:2]
    ok = (major, minor) >= (3, 11)
    return Check(
        name="python >= 3.11",
        status="ok" if ok else "fail",
        required=True,
        message=f"python {sys.version.split()[0]}",
    )


def check_git() -> Check:
    path = _which("git")
    if not path:
        return Check(name="git", status="fail", required=True, message="git not found in PATH")
    rc, out, _ = _run(["git", "--version"])
    return Check(
        name="git",
        status="ok" if rc == 0 else "fail",
        required=True,
        message=out or "git invocation failed",
        detail={"path": path},
    )


def check_docker() -> Check:
    path = _which("docker")
    if not path:
        return Check(name="docker", status="warn", required=False,
                     message="docker not in PATH; runner will fall back to local subprocess")
    rc, out, err = _run(["docker", "info", "--format", "{{.ServerVersion}}"], timeout=5.0)
    if rc == 0 and out:
        return Check(name="docker", status="ok", required=False,
                     message=f"docker server {out}", detail={"path": path, "server_version": out})
    return Check(name="docker", status="warn", required=False,
                 message=f"docker CLI found but daemon not reachable: {err or 'no output'}",
                 detail={"path": path})


def check_gh() -> Check:
    path = _which("gh")
    if not path:
        return Check(name="gh", status="warn", required=False,
                     message="gh CLI not installed; PR creation will be unavailable")
    rc, out, _ = _run(["gh", "auth", "status"], timeout=5.0)
    return Check(
        name="gh auth",
        status="ok" if rc == 0 else "warn",
        required=False,
        message="gh authenticated" if rc == 0 else "gh not authenticated; PR creation will fail",
        detail={"path": path},
    )


def check_claude_cli() -> Check:
    path = _which("claude")
    if not path:
        return Check(name="claude CLI", status="fail", required=True,
                     message="claude CLI not in PATH; main worker path requires local Claude Code")
    rc, out, _ = _run(["claude", "--version"], timeout=5.0)
    return Check(
        name="claude CLI",
        status="ok" if rc == 0 else "fail",
        required=True,
        message=out or "claude --version failed",
        detail={"path": path},
    )


def check_claude_smoke() -> Check:
    """Optional: round-trip a trivial prompt through `claude -p`. Slow
    (multi-second), so only emitted when called explicitly."""
    path = _which("claude")
    if not path:
        return Check(name="claude smoke", status="fail", required=False,
                     message="claude CLI not installed")
    # Delegate to runner.claude_cli so production + doctor share the path.
    from runner.claude_cli import smoke_check
    res = smoke_check(timeout=45.0)
    if res.ok and "OK" in res.text.upper():
        cost = res.cost_usd if res.cost_usd is not None else "subscription"
        return Check(
            name="claude smoke",
            status="ok", required=False,
            message=f"round-trip in {res.duration_s}s (auth={res.auth_mode}, cost={cost})",
            detail={"duration_s": res.duration_s, "auth_mode": res.auth_mode,
                    "cost_usd": res.cost_usd},
        )
    return Check(name="claude smoke", status="warn", required=False,
                 message=res.error or f"unexpected response: {res.text[:80]!r}",
                 detail={"exit": res.exit_code, "duration_s": res.duration_s})


def check_auth_mode() -> Check:
    """M18-P0: report the configured worker_mode and whether it's usable.

    Always part of the default check set so the operator sees auth state
    on every `claude247 doctor` invocation."""
    import os as _os
    from runner.auth import (
        allow_api_fallback,
        ensure_usable,
        resolve_worker_mode,
    )
    mode = resolve_worker_mode()
    decision = ensure_usable()
    api_key_present = bool(_os.environ.get("ANTHROPIC_API_KEY"))
    api_used_for_workers = (mode == "anthropic_api")
    detail = {
        "worker_mode": mode,
        "usable": decision.ok,
        "reason": decision.reason,
        "anthropic_api_key_present": api_key_present,
        "anthropic_api_used_for_workers": api_used_for_workers,
        "allow_api_fallback": allow_api_fallback(),
    }
    if mode == "local_claude_code" and api_key_present:
        msg = (f"worker_mode={mode}, usable={decision.ok}; "
                "ANTHROPIC_API_KEY present in env but IGNORED for workers "
                "(stripped from subprocess env per worker_mode)")
        status = "ok" if decision.ok else "fail"
    elif mode == "anthropic_api" and not api_key_present:
        msg = f"worker_mode={mode} but ANTHROPIC_API_KEY missing — will fail"
        status = "fail"
    else:
        msg = (f"worker_mode={mode}, usable={decision.ok} — {decision.reason}")
        status = "ok" if decision.ok else "fail"
    return Check(
        name="auth mode",
        status=status, required=True,
        message=msg, detail=detail,
    )


def check_sqlite() -> Check:
    import sqlite3
    return Check(name="sqlite3 (python)", status="ok", required=True,
                 message=f"sqlite3 {sqlite3.sqlite_version}")


def check_state_dir() -> Check:
    p = default_config_dir()
    try:
        p.mkdir(parents=True, exist_ok=True)
        ok = os.access(p, os.W_OK)
        return Check(
            name="state dir writable",
            status="ok" if ok else "fail",
            required=True,
            message=str(p),
            detail={"path": str(p), "exists": True, "writable": ok},
        )
    except OSError as e:
        return Check(name="state dir writable", status="fail", required=True,
                     message=f"cannot create {p}: {e}")


def check_db_init() -> Check:
    try:
        path = init_db()
        with open_db(path) as conn:
            v = schema_version(conn)
        return Check(name="sqlite db init", status="ok", required=True,
                     message=f"schema v{v} at {path}",
                     detail={"path": str(path), "schema_version": v})
    except (OSError, RuntimeError) as e:
        return Check(name="sqlite db init", status="fail", required=True,
                     message=f"{type(e).__name__}: {e}")


def check_repos_yaml() -> Check:
    p = default_repos_path()
    if not p.exists():
        return Check(
            name="repos.yaml",
            status="warn",
            required=False,
            message=f"no registry at {p}; run `claude247 repo add` to create",
            detail={"path": str(p), "exists": False},
        )
    try:
        entries = load_registry(p)
        return Check(
            name="repos.yaml",
            status="ok",
            required=False,
            message=f"{len(entries)} repo(s) registered",
            detail={"path": str(p), "count": len(entries),
                    "ids": [e.id for e in entries]},
        )
    except (OSError, ValueError) as e:
        return Check(name="repos.yaml", status="fail", required=False,
                     message=f"parse error: {e}", detail={"path": str(p)})


def check_dashboard_port() -> Check:
    cfg = load_config()
    host, port = cfg.dashboard_host, cfg.dashboard_port
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(0.5)
    try:
        s.bind((host, port))
        s.close()
        return Check(name="dashboard port free",
                     status="ok", required=False,
                     message=f"{host}:{port} available",
                     detail={"host": host, "port": port})
    except OSError as e:
        return Check(name="dashboard port free",
                     status="warn", required=False,
                     message=f"{host}:{port} busy: {e}",
                     detail={"host": host, "port": port, "error": str(e)})


def check_ntfy() -> Check:
    cfg = load_config()
    topic = cfg.get("notifications.ntfy.topic") or ""
    if not topic:
        return Check(name="ntfy notifications", status="warn", required=False,
                     message="not configured; notifications will go to local log only")
    return Check(name="ntfy notifications", status="ok", required=False,
                 message=f"topic configured: {topic}",
                 detail={"topic": topic})


def check_validator_keys() -> Check:
    """Check whether at least one validator API key is configured."""
    gem = bool(os.environ.get("GEMINI_API_KEY"))
    op = bool(os.environ.get("OPENAI_API_KEY"))
    if gem or op:
        names = [n for n, ok in (("GEMINI_API_KEY", gem), ("OPENAI_API_KEY", op)) if ok]
        return Check(name="validator API keys", status="ok", required=False,
                     message=f"configured: {', '.join(names)}",
                     detail={"gemini": gem, "openai": op})
    return Check(name="validator API keys", status="warn", required=False,
                 message="neither GEMINI_API_KEY nor OPENAI_API_KEY set; validators will use mocks")


ALL_CHECKS: list[Callable[[], Check]] = [
    check_macos,
    check_python,
    check_git,
    check_docker,
    check_gh,
    check_claude_cli,
    check_auth_mode,
    check_sqlite,
    check_state_dir,
    check_db_init,
    check_repos_yaml,
    check_dashboard_port,
    check_ntfy,
    check_validator_keys,
]


def run_doctor(checks: list[Callable[[], Check]] | None = None) -> tuple[list[Check], bool]:
    """Run all checks. Returns (checks, ok) where ok = no required failures."""
    results = [c() for c in (checks or ALL_CHECKS)]
    ok = not any(c.status == "fail" and c.required for c in results)
    return results, ok


def to_json(checks: list[Check], ok: bool) -> str:
    payload = {
        "ok": ok,
        "checks": [asdict(c) for c in checks],
        "summary": {
            "ok": sum(1 for c in checks if c.status == "ok"),
            "warn": sum(1 for c in checks if c.status == "warn"),
            "fail": sum(1 for c in checks if c.status == "fail"),
        },
    }
    return json.dumps(payload, indent=2, sort_keys=True)


def to_plain(checks: list[Check], ok: bool) -> str:
    lines = []
    for c in checks:
        symbol = {"ok": "✓", "warn": "•", "fail": "✗"}.get(c.status, "?")
        tag = " (required)" if c.required and c.status != "ok" else ""
        lines.append(f"{symbol} {c.name}{tag}: {c.message}")
    lines.append("")
    lines.append("OK" if ok else "FAIL — at least one required check failed")
    return "\n".join(lines)
