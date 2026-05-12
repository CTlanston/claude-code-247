"""Regression tests for scripts/codex_budget_guard.sh — Track R (Cycle 15).

The tests use a stub codex binary (via CODEX_BIN env var) so we never
spend real OpenAI tokens during pytest. The stub prints a controlled
output mimicking real codex's format ("tokens used\\n<NUMBER>") and
exits with a controlled code.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Optional

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
GUARD = REPO_ROOT / "scripts" / "codex_budget_guard.sh"


def _make_stub_codex(tmp_path: Path, *, tokens: int = 1000,
                     exit_code: int = 0,
                     extra_output: str = "") -> Path:
    """Create a tmp 'codex' binary that prints a controlled output."""
    stub = tmp_path / "codex_stub.sh"
    stub.write_text(
        "#!/usr/bin/env bash\n"
        f"echo \"{extra_output}\"\n"
        f"echo 'tokens used'\n"
        f"echo '{tokens}'\n"
        f"exit {exit_code}\n"
    )
    stub.chmod(0o755)
    return stub


def _run_guard(tmp_path: Path, args, *,
               stub_codex: Optional[Path] = None,
               daily_cap: Optional[int] = None,
               call_cap: Optional[int] = None,
               existing_log: Optional[str] = None) -> subprocess.CompletedProcess:
    """Invoke the guard with a controlled env."""
    log = tmp_path / "codex-spend.jsonl"
    if existing_log is not None:
        log.write_text(existing_log)
    env = os.environ.copy()
    env["AUTODEV_CODEX_LOG"] = str(log)
    if daily_cap is not None:
        env["AUTODEV_CODEX_DAILY_CAP"] = str(daily_cap)
    if call_cap is not None:
        env["AUTODEV_CODEX_CALL_CAP"] = str(call_cap)
    if stub_codex is None:
        stub_codex = _make_stub_codex(tmp_path)
    env["CODEX_BIN"] = str(stub_codex)
    return subprocess.run(
        [str(GUARD), *args],
        capture_output=True, text=True, env=env,
        timeout=30,
    )


def _read_log(tmp_path: Path):
    """Parse the JSONL log into a list of dicts."""
    log = tmp_path / "codex-spend.jsonl"
    if not log.exists():
        return []
    out = []
    for line in log.read_text().splitlines():
        if not line.strip():
            continue
        out.append(json.loads(line))
    return out


# --- Basic call recording -------------------------------------------------


def test_guard_records_normal_call(tmp_path):
    """A successful codex call writes one log entry with the token count."""
    result = _run_guard(tmp_path, ["exec", "hello"],
                        stub_codex=_make_stub_codex(tmp_path, tokens=1234))
    assert result.returncode == 0
    entries = _read_log(tmp_path)
    assert len(entries) == 1
    entry = entries[0]
    assert entry["tokens"] == 1234
    assert entry["exit"] == 0
    assert entry["anomaly"] == ""
    assert "exec hello" in entry["args"]
    assert "date" in entry
    assert "ts" in entry
    assert isinstance(entry["duration_s"], int)


def test_guard_forwards_codex_stdout(tmp_path):
    """The guard surfaces codex's stdout to the caller."""
    stub = _make_stub_codex(tmp_path, tokens=100,
                            extra_output="codex review output here")
    result = _run_guard(tmp_path, ["review", "--commit", "HEAD"],
                        stub_codex=stub)
    assert "codex review output here" in result.stdout


def test_guard_forwards_codex_exit_code(tmp_path):
    """Non-zero codex exit propagates through the guard."""
    stub = _make_stub_codex(tmp_path, tokens=500, exit_code=7)
    result = _run_guard(tmp_path, ["exec", "fail"], stub_codex=stub)
    assert result.returncode == 7
    entries = _read_log(tmp_path)
    assert len(entries) == 1
    assert entries[0]["exit"] == 7


# --- Daily cap enforcement -------------------------------------------------


def test_guard_refuses_when_daily_cap_exceeded(tmp_path):
    """Pre-existing log entries summing >= cap → refuse with exit 2."""
    from datetime import datetime, timezone
    today = datetime.now(tz=timezone.utc).strftime("%Y-%m-%d")
    existing = (
        json.dumps({"date": today, "ts": 1, "duration_s": 1, "args": "x",
                    "tokens": 150000, "exit": 0, "anomaly": ""}) + "\n"
        + json.dumps({"date": today, "ts": 2, "duration_s": 1, "args": "y",
                      "tokens": 60000, "exit": 0, "anomaly": ""}) + "\n"
    )
    # Daily cap default 200000; we have 210000 already → should refuse
    result = _run_guard(tmp_path, ["exec", "x"],
                        existing_log=existing)
    assert result.returncode == 2
    # Stderr should mention refusal
    assert "daily_cap_exceeded" in (result.stderr + result.stdout)


def test_guard_passes_when_under_daily_cap(tmp_path):
    """Pre-existing total below cap → call proceeds."""
    from datetime import datetime, timezone
    today = datetime.now(tz=timezone.utc).strftime("%Y-%m-%d")
    existing = json.dumps({
        "date": today, "ts": 1, "duration_s": 1, "args": "x",
        "tokens": 50000, "exit": 0, "anomaly": "",
    }) + "\n"
    result = _run_guard(tmp_path, ["exec", "y"],
                        daily_cap=200000,
                        existing_log=existing,
                        stub_codex=_make_stub_codex(tmp_path, tokens=10000))
    assert result.returncode == 0
    entries = _read_log(tmp_path)
    assert len(entries) == 2
    assert entries[-1]["tokens"] == 10000


def test_guard_ignores_yesterday_total(tmp_path):
    """Yesterday's tokens don't count toward today's cap."""
    existing = json.dumps({
        "date": "1970-01-01", "ts": 1, "duration_s": 1, "args": "x",
        "tokens": 500000, "exit": 0, "anomaly": "",
    }) + "\n"
    result = _run_guard(tmp_path, ["exec", "y"],
                        daily_cap=200000,
                        existing_log=existing)
    assert result.returncode == 0


# --- Per-call anomaly flag -------------------------------------------------


def test_guard_flags_per_call_cap_anomaly(tmp_path):
    """A single call exceeding per-call cap is logged with anomaly flag
    but is NOT refused (it's already complete)."""
    stub = _make_stub_codex(tmp_path, tokens=80000)
    result = _run_guard(tmp_path, ["exec", "huge"],
                        call_cap=60000, stub_codex=stub)
    assert result.returncode == 0
    entries = _read_log(tmp_path)
    assert entries[-1]["anomaly"] == "per_call_cap_exceeded"
    assert entries[-1]["tokens"] == 80000


def test_guard_no_anomaly_when_under_call_cap(tmp_path):
    stub = _make_stub_codex(tmp_path, tokens=30000)
    result = _run_guard(tmp_path, ["exec", "small"],
                        call_cap=60000, stub_codex=stub)
    assert result.returncode == 0
    entries = _read_log(tmp_path)
    assert entries[-1]["anomaly"] == ""


# --- Token-parsing robustness ---------------------------------------------


def test_guard_handles_codex_output_with_commas(tmp_path):
    """codex may print '23,253' — parse correctly."""
    stub = tmp_path / "stub.sh"
    stub.write_text(
        "#!/usr/bin/env bash\n"
        "echo 'some review output'\n"
        "echo 'tokens used'\n"
        "echo '23,253'\n"
        "exit 0\n"
    )
    stub.chmod(0o755)
    _run_guard(tmp_path, ["exec", "x"], stub_codex=stub)
    entries = _read_log(tmp_path)
    assert entries[-1]["tokens"] == 23253


def test_guard_zero_tokens_when_unparseable(tmp_path):
    """If codex output has no recognizable token line, log tokens=0."""
    stub = tmp_path / "stub.sh"
    stub.write_text(
        "#!/usr/bin/env bash\n"
        "echo 'no token info here'\n"
        "exit 0\n"
    )
    stub.chmod(0o755)
    _run_guard(tmp_path, ["exec", "x"], stub_codex=stub)
    entries = _read_log(tmp_path)
    assert entries[-1]["tokens"] == 0


# --- Concurrent calls -----------------------------------------------------


def test_guard_concurrent_calls_no_log_corruption(tmp_path):
    """Two simultaneous guard invocations must both append valid JSON lines.
    (Append-only mode with line-buffered writes is the assumption.)"""
    import threading
    stub = _make_stub_codex(tmp_path, tokens=1000)

    def call():
        _run_guard(tmp_path, ["exec", "x"], stub_codex=stub)

    threads = [threading.Thread(target=call) for _ in range(3)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    entries = _read_log(tmp_path)
    assert len(entries) == 3, f"got {len(entries)} entries, expected 3"
    # Each entry must be valid JSON with required fields
    for e in entries:
        assert "tokens" in e
        assert e["tokens"] == 1000
