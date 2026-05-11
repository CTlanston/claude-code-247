"""ClaudeCodeCLIExecutor tests — pure unit tests, no real CLI calls."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from types import SimpleNamespace

from autodev.executors.claude_code_cli import (
    ClaudeCodeCLIExecutor,
    ExecutionResult,
)


def test_executor_unavailable_when_no_docker_and_no_host_cli(monkeypatch):
    # Force "no docker" and "no host claude"
    monkeypatch.setattr("shutil.which", lambda name: None)
    e = ClaudeCodeCLIExecutor(via_docker=True)
    ok, _ = e.is_available()
    assert not ok


def test_executor_classifies_rate_limit(monkeypatch):
    def fake_run(*args, **kw):
        env = SimpleNamespace(
            returncode=0,
            stdout='{"is_error":true,"result":"Rate limit exceeded","usage":{"input_tokens":0,"output_tokens":0}}',
            stderr="",
        )
        return env
    monkeypatch.setattr(subprocess, "run", fake_run)
    monkeypatch.setattr("shutil.which", lambda n: "/usr/local/bin/claude" if n == "claude" else None)
    e = ClaudeCodeCLIExecutor(via_docker=False)
    r = e.run_prompt("hi")
    assert r.rate_limited is True
    assert r.classify() == "rate_limited"


def test_executor_classifies_permission(monkeypatch):
    def fake_run(*args, **kw):
        return SimpleNamespace(
            returncode=0,
            stdout='{"is_error":true,"result":"permission denied","usage":{"input_tokens":0,"output_tokens":0}}',
            stderr="",
        )
    monkeypatch.setattr(subprocess, "run", fake_run)
    monkeypatch.setattr("shutil.which", lambda n: "/usr/local/bin/claude" if n == "claude" else None)
    r = ClaudeCodeCLIExecutor(via_docker=False).run_prompt("hi")
    assert r.permission_needed is True
    assert r.classify() == "permission_needed"


def test_executor_classifies_success(monkeypatch):
    def fake_run(*args, **kw):
        return SimpleNamespace(
            returncode=0,
            stdout='{"is_error":false,"result":"all good","total_cost_usd":0.0,"usage":{"input_tokens":10,"output_tokens":5}}',
            stderr="",
        )
    monkeypatch.setattr(subprocess, "run", fake_run)
    monkeypatch.setattr("shutil.which", lambda n: "/usr/local/bin/claude" if n == "claude" else None)
    r = ClaudeCodeCLIExecutor(via_docker=False).run_prompt("hi")
    assert r.success is True
    assert r.classify() == "success"
    assert r.summary.startswith("all good")


def test_executor_classifies_timeout(monkeypatch):
    def fake_run(*args, **kw):
        raise subprocess.TimeoutExpired(cmd=["claude"], timeout=5)
    monkeypatch.setattr(subprocess, "run", fake_run)
    monkeypatch.setattr("shutil.which", lambda n: "/usr/local/bin/claude" if n == "claude" else None)
    r = ClaudeCodeCLIExecutor(via_docker=False, timeout_seconds=5).run_prompt("hi")
    assert r.timed_out
    assert r.classify() == "timeout"


def test_executor_token_routing_oat01(monkeypatch):
    # When ANTHROPIC_API_KEY looks like an OAuth token, executor should
    # route it via CLAUDE_CODE_OAUTH_TOKEN in the docker env.
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-oat01-fake")
    monkeypatch.delenv("CLAUDE_CODE_OAUTH_TOKEN", raising=False)
    monkeypatch.setattr("shutil.which", lambda n: "/usr/local/bin/docker")
    e = ClaudeCodeCLIExecutor(via_docker=True)
    argv = e._build_argv(
        prompt="hi", system_prompt=None, model="claude-sonnet-4-6",
        allowed_tools="Read", permission_mode="bypassPermissions", extra_args=[],
    )
    # The token env var should be CLAUDE_CODE_OAUTH_TOKEN, not ANTHROPIC_API_KEY.
    joined = " ".join(argv)
    assert "CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-fake" in joined
    assert "ANTHROPIC_API_KEY=sk-ant-oat01-fake" not in joined
