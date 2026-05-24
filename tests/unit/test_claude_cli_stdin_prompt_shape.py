"""M18-P0: lock the stdin-prompt contract (regression guard for the
M17-discovered CLI 2.1.142 incompat) AND verify env-scrub behavior."""
from __future__ import annotations

import json
import os
import stat
from pathlib import Path

import pytest

from runner.claude_cli import ClaudeInvocation, invoke


def _fake_claude(tmp_path: Path, *, stdout: str = "{}", exit_code: int = 0,
                  argv_log: Path | None = None, stdin_log: Path | None = None,
                  env_log: Path | None = None) -> Path:
    fake = tmp_path / "claude"
    lines = ["#!/bin/sh"]
    if argv_log:
        lines.append(f"printf '%s\\n' \"$@\" > {argv_log}")
    if stdin_log:
        lines.append(f"cat > {stdin_log}")
    if env_log:
        lines.append(f"env > {env_log}")
    lines.append(f"printf '%s' '{stdout}'")
    lines.append(f"exit {exit_code}")
    fake.write_text("\n".join(lines) + "\n")
    fake.chmod(fake.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return fake


def test_user_prompt_is_sent_via_stdin_not_argv(tmp_path: Path) -> None:
    argv_log = tmp_path / "argv.txt"
    stdin_log = tmp_path / "stdin.txt"
    fake = _fake_claude(tmp_path, stdout=json.dumps({"result": "OK"}),
                         argv_log=argv_log, stdin_log=stdin_log)
    inv = ClaudeInvocation(
        role="test", user_prompt="THE_UNIQUE_PROMPT",
        system_prompt="be brief", allowed_tools=["Read", "Edit"],
    )
    invoke(inv, claude_bin=str(fake), worker_mode="local_claude_code")
    argv = argv_log.read_text().splitlines()
    # Regression: the prompt must NOT be a positional argv element.
    assert "THE_UNIQUE_PROMPT" not in argv
    assert stdin_log.read_text() == "THE_UNIQUE_PROMPT"


def test_anthropic_api_key_stripped_in_local_mode(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test-redacted")
    env_log = tmp_path / "env.txt"
    fake = _fake_claude(tmp_path, stdout=json.dumps({"result": "OK"}),
                         env_log=env_log)
    inv = ClaudeInvocation(
        role="t", user_prompt="x", system_prompt="y",
    )
    invoke(inv, claude_bin=str(fake), worker_mode="local_claude_code")
    env_text = env_log.read_text()
    # The key must NOT have leaked into the subprocess env.
    assert "ANTHROPIC_API_KEY" not in env_text


def test_anthropic_api_key_present_in_api_mode(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test-redacted")
    env_log = tmp_path / "env.txt"
    fake = _fake_claude(tmp_path, stdout=json.dumps({"result": "OK"}),
                         env_log=env_log)
    inv = ClaudeInvocation(
        role="t", user_prompt="x", system_prompt="y",
    )
    invoke(inv, claude_bin=str(fake), worker_mode="anthropic_api")
    env_text = env_log.read_text()
    assert "ANTHROPIC_API_KEY=sk-test-redacted" in env_text


def test_auth_mode_label_reflects_actual_env(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The auth_mode reported on the result must match what the
    subprocess actually saw — no silent label drift."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-x")
    fake = _fake_claude(tmp_path, stdout=json.dumps({"result": "OK"}))
    # local_claude_code → key stripped → label should be local_claude_code
    res_local = invoke(
        ClaudeInvocation(role="t", user_prompt="x", system_prompt="y"),
        claude_bin=str(fake), worker_mode="local_claude_code",
    )
    assert res_local.auth_mode == "local_claude_code"
    # anthropic_api → key present → label should be anthropic_api
    res_api = invoke(
        ClaudeInvocation(role="t", user_prompt="x", system_prompt="y"),
        claude_bin=str(fake), worker_mode="anthropic_api",
    )
    assert res_api.auth_mode == "anthropic_api"
