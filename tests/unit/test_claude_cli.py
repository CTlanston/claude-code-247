from __future__ import annotations

import json
import os
import stat
from pathlib import Path

from runner.claude_cli import ClaudeInvocation, invoke


def _make_fake_claude(tmp_path: Path, *, stdout: str = "{}", exit_code: int = 0,
                     args_log: Path | None = None,
                     stdin_log: Path | None = None) -> Path:
    """Generate a fake `claude` binary that writes its argv (one per line)
    to args_log and prints `stdout`. Used to assert what we passed to the
    CLI without needing the real one. Optionally captures stdin to
    stdin_log so the test can verify prompt was sent that way."""
    fake = tmp_path / "claude"
    log_part = ""
    if args_log:
        log_part += f"printf '%s\\n' \"$@\" > {args_log}\n"
    if stdin_log:
        log_part += f"cat > {stdin_log}\n"
    fake.write_text(
        "#!/bin/sh\n"
        f"{log_part}"
        f"printf '%s' '{stdout}'\n"
        f"exit {exit_code}\n"
    )
    fake.chmod(fake.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return fake


def test_invoke_passes_correct_argv(tmp_path: Path) -> None:
    log = tmp_path / "argv.log"
    stdin_log = tmp_path / "stdin.log"
    fake = _make_fake_claude(
        tmp_path, stdout=json.dumps({"result": "OK"}),
        args_log=log, stdin_log=stdin_log,
    )
    inv = ClaudeInvocation(
        role="t",
        user_prompt="hello",
        system_prompt="be brief",
        allowed_tools=["Read", "Edit"],
        model="claude-sonnet-4-6",
    )
    res = invoke(inv, claude_bin=str(fake))
    assert res.ok
    assert res.text == "OK"
    argv = log.read_text().splitlines()
    assert "--print" in argv
    assert "--output-format" in argv
    assert "json" in argv
    assert "--append-system-prompt" in argv
    assert "be brief" in argv
    assert "--allowedTools" in argv
    assert "Read,Edit" in argv
    assert "--model" in argv
    assert "claude-sonnet-4-6" in argv
    assert "--permission-mode" in argv
    assert "bypassPermissions" in argv
    # User prompt now flows via stdin, NOT as a positional arg (the
    # commander.js parser treats --allowedTools as variadic and would
    # otherwise swallow the prompt).
    assert "hello" not in argv
    assert stdin_log.read_text() == "hello"


def test_invoke_handles_non_json_output(tmp_path: Path) -> None:
    fake = _make_fake_claude(tmp_path, stdout="not json")
    res = invoke(
        ClaudeInvocation(role="t", user_prompt="x", system_prompt="y"),
        claude_bin=str(fake),
    )
    assert res.raw == {"raw_text": "not json"}
    assert res.text == ""


def test_invoke_records_usage_and_cost(tmp_path: Path) -> None:
    payload = {
        "result": "hi",
        "usage": {"input_tokens": 11, "output_tokens": 22},
        "total_cost_usd": 0.0123,
    }
    fake = _make_fake_claude(tmp_path, stdout=json.dumps(payload))
    res = invoke(
        ClaudeInvocation(role="t", user_prompt="x", system_prompt="y"),
        claude_bin=str(fake),
    )
    assert res.input_tokens == 11
    assert res.output_tokens == 22
    assert res.cost_usd == 0.0123


def test_invoke_marks_error_on_is_error_true(tmp_path: Path) -> None:
    payload = {"result": "...", "is_error": True}
    fake = _make_fake_claude(tmp_path, stdout=json.dumps(payload), exit_code=0)
    res = invoke(
        ClaudeInvocation(role="t", user_prompt="x", system_prompt="y"),
        claude_bin=str(fake),
    )
    assert res.ok is False


def test_invoke_missing_binary_yields_error_result() -> None:
    res = invoke(
        ClaudeInvocation(role="t", user_prompt="x", system_prompt="y"),
        claude_bin="/path/does/not/exist/claude",
    )
    assert res.ok is False
    assert res.exit_code == -1
    assert "not found" in (res.error or "")
