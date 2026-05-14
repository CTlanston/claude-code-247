"""Regression tests for scripts/autodev_continuous_cycle.sh (Cycle 25).

The wake script honors a set of stop conditions and a few timing
controls. Tests cover each branch with a tmp_path repo + a stub
`claude` binary that just records its invocation.
"""
from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "autodev_continuous_cycle.sh"


def _seed_repo(tmp_path: Path, *,
               level_overall: int = 4,
               with_blocked: bool = False,
               with_stopswitch: bool = False,
               with_done: bool = False,
               health: int = 100,
               last_wake_age_s: int | None = None,
               rate_limit_until: int | None = None) -> None:
    """Lay down the minimum file structure the wake script expects."""
    (tmp_path / "reports" / "runs").mkdir(parents=True, exist_ok=True)
    # Stub the prompt file the wake script reads. Without it the script
    # exits early at "prompt file missing".
    (tmp_path / "scripts").mkdir(parents=True, exist_ok=True)
    (tmp_path / "scripts" / "autodev_cycle_prompt.md").write_text(
        "Stub cycle prompt for tests.\n"
    )
    if with_done:
        (tmp_path / "reports" / "AUTODEV_DONE.md").write_text("done\n")
    if with_stopswitch:
        (tmp_path / "reports" / "STOPSWITCH").write_text("halt\n")
    if with_blocked:
        (tmp_path / "BLOCKED.md").write_text("blocked\n")
        # Make it 1 minute old (under 24h) — should skip cycle
        # but not exit non-zero
        os.utime(tmp_path / "BLOCKED.md", (time.time() - 60,) * 2)
    (tmp_path / "reports" / "health.json").write_text(
        json.dumps({"score": health}) + "\n"
    )
    (tmp_path / "LEVEL.md").write_text(
        f"# LEVEL.md\n\nOverall L = {level_overall}\n"
    )
    if last_wake_age_s is not None:
        (tmp_path / "reports" / "runs" / "last_wake.ts").write_text(
            str(int(time.time() - last_wake_age_s)) + "\n"
        )
    if rate_limit_until is not None:
        (tmp_path / "reports" / "quota-rate-limit-until.ts").write_text(
            str(rate_limit_until) + "\n"
        )


def _stub_claude(tmp_path: Path, *, sleep_s: int = 0,
                 exit_code: int = 0, output: str = "") -> Path:
    """Stub `claude` binary that just records its invocation + sleeps."""
    stub = tmp_path / "claude_stub.sh"
    stub.write_text(
        "#!/usr/bin/env bash\n"
        f"echo \"stub called with: $@\" > {tmp_path}/claude_invocation.log\n"
        f"echo '{output}'\n"
        f"sleep {sleep_s}\n"
        f"exit {exit_code}\n"
    )
    stub.chmod(0o755)
    return stub


def _run_wake(tmp_path: Path, *,
              target_l: int = 5,
              extra_env: dict | None = None,
              timeout: int = 30) -> subprocess.CompletedProcess:
    env = os.environ.copy()
    env["AUTODEV_REPO_ROOT"] = str(tmp_path)
    env["AUTODEV_TARGET_L"] = str(target_l)
    # If the caller hasn't provided AUTODEV_CLAUDE_BIN via extra_env,
    # spin up a default empty-output stub. Important: do this BEFORE
    # extra_env override so we don't overwrite a caller-provided stub.
    extra_env = extra_env or {}
    if "AUTODEV_CLAUDE_BIN" not in extra_env \
            and "AUTODEV_CLAUDE_BIN" not in env:
        env["AUTODEV_CLAUDE_BIN"] = str(_stub_claude(tmp_path))
    env.update({k: str(v) for k, v in extra_env.items()})
    return subprocess.run(
        [str(SCRIPT)], capture_output=True, text=True, env=env,
        timeout=timeout,
    )


# --- Existence / executable ---------------------------------------------


def test_script_exists():
    assert SCRIPT.exists()


def test_script_executable():
    assert os.access(SCRIPT, os.X_OK)


# --- Stop conditions ----------------------------------------------------


def test_autodev_done_present_exits_0_without_running_claude(tmp_path):
    """reports/AUTODEV_DONE.md present → exit 0, no claude invocation."""
    _seed_repo(tmp_path, with_done=True)
    r = _run_wake(tmp_path)
    assert r.returncode == 0
    assert not (tmp_path / "claude_invocation.log").exists(), (
        f"claude was invoked despite AUTODEV_DONE.md"
    )


def test_stopswitch_present_exits_0_without_running_claude(tmp_path):
    _seed_repo(tmp_path, with_stopswitch=True)
    r = _run_wake(tmp_path)
    assert r.returncode == 0
    assert not (tmp_path / "claude_invocation.log").exists()


def test_blocked_under_24h_skips_cycle(tmp_path):
    """BLOCKED.md < 24h old → skip cycle, exit 0, no claude."""
    _seed_repo(tmp_path, with_blocked=True)
    r = _run_wake(tmp_path)
    assert r.returncode == 0
    assert not (tmp_path / "claude_invocation.log").exists()


def test_health_below_50_skips_cycle(tmp_path):
    _seed_repo(tmp_path, health=42)
    r = _run_wake(tmp_path)
    assert r.returncode == 0
    assert not (tmp_path / "claude_invocation.log").exists()


def test_target_l_reached_writes_done_md(tmp_path):
    """Overall L >= AUTODEV_TARGET_L → writes AUTODEV_DONE.md, no claude."""
    _seed_repo(tmp_path, level_overall=5)
    r = _run_wake(tmp_path, target_l=5)
    assert r.returncode == 0
    done = tmp_path / "reports" / "AUTODEV_DONE.md"
    assert done.exists(), "AUTODEV_DONE.md should have been written"
    text = done.read_text()
    assert "Overall L = 5" in text or "target 5" in text
    assert not (tmp_path / "claude_invocation.log").exists()


# --- Cooldown ----------------------------------------------------------


def test_cooldown_under_5_min_exits_0(tmp_path):
    """If last_wake.ts is < 5 min old, exit 0 without running."""
    _seed_repo(tmp_path, last_wake_age_s=60)  # 1 min ago
    r = _run_wake(tmp_path)
    assert r.returncode == 0
    assert not (tmp_path / "claude_invocation.log").exists()


def test_cooldown_over_5_min_proceeds(tmp_path):
    """If last_wake.ts is > 5 min old, the wake proceeds."""
    _seed_repo(tmp_path, last_wake_age_s=600)  # 10 min ago
    r = _run_wake(tmp_path)
    assert r.returncode == 0
    assert (tmp_path / "claude_invocation.log").exists()


# --- Rate-limit ---------------------------------------------------------


def test_rate_limit_active_skips_cycle(tmp_path):
    """quota-rate-limit-until.ts in the future → skip cycle."""
    future = int(time.time() + 3600)
    _seed_repo(tmp_path, rate_limit_until=future)
    r = _run_wake(tmp_path)
    assert r.returncode == 0
    assert not (tmp_path / "claude_invocation.log").exists()
    # File should NOT be deleted while still in the future
    assert (tmp_path / "reports" / "quota-rate-limit-until.ts").exists()


def test_rate_limit_expired_proceeds_and_cleans_up(tmp_path):
    """quota-rate-limit-until.ts in the past → proceed, delete the file."""
    past = int(time.time() - 60)
    _seed_repo(tmp_path, rate_limit_until=past)
    r = _run_wake(tmp_path)
    assert r.returncode == 0
    assert (tmp_path / "claude_invocation.log").exists()
    assert not (tmp_path / "reports" / "quota-rate-limit-until.ts").exists()


# --- Normal cycle dispatch ----------------------------------------------


def test_normal_dispatch_invokes_claude(tmp_path):
    """Clean state + below target → claude is invoked."""
    _seed_repo(tmp_path)
    r = _run_wake(tmp_path)
    assert r.returncode == 0
    log = tmp_path / "claude_invocation.log"
    assert log.exists()
    text = log.read_text()
    # The wake script should pass `-p` and `--dangerously-skip-permissions`
    assert "-p" in text


def test_normal_dispatch_writes_last_wake_ts(tmp_path):
    """The wake updates reports/runs/last_wake.ts so cooldown works."""
    _seed_repo(tmp_path)
    r = _run_wake(tmp_path)
    assert r.returncode == 0
    ts_file = tmp_path / "reports" / "runs" / "last_wake.ts"
    assert ts_file.exists()
    # Should be roughly "now"
    ts = int(ts_file.read_text().strip())
    assert abs(ts - int(time.time())) < 60


def test_rate_limit_detected_in_log_triggers_backoff(tmp_path):
    """If `claude -p` emits 'rate limit', the wake script writes a
    quota-rate-limit-until.ts file ~1h in the future."""
    stub = _stub_claude(tmp_path, output="ERROR: rate limit exceeded, 429")
    _seed_repo(tmp_path)
    r = _run_wake(tmp_path, extra_env={"AUTODEV_CLAUDE_BIN": str(stub)})
    assert r.returncode == 0
    ql = tmp_path / "reports" / "quota-rate-limit-until.ts"
    assert ql.exists()
    until = int(ql.read_text().strip())
    # Approximately 1h from now
    assert int(time.time() + 3000) < until < int(time.time() + 7200)


# --- Always exits 0 (no launchd ThrottleInterval) ----------------------


def test_always_exits_0_even_when_claude_fails(tmp_path):
    """Even if claude returns nonzero, the wake script exits 0 so
    launchd doesn't enter ThrottleInterval."""
    stub = _stub_claude(tmp_path, exit_code=7)
    _seed_repo(tmp_path)
    r = _run_wake(tmp_path, extra_env={"AUTODEV_CLAUDE_BIN": str(stub)})
    assert r.returncode == 0


# --- Cycle β: OAuth/API token routing ----------------------------------


def _env_dumping_claude_stub(tmp_path: Path) -> Path:
    """Stub `claude` that dumps a few specific env vars to a sidecar
    file so the test can assert on routing decisions.

    Important: the sidecar file is plain text, one `KEY=value` per
    line. Only the two vars we route to are dumped; nothing else
    in the real environment is exposed. This stub never touches the
    real keychain or .env.
    """
    stub = tmp_path / "claude_env_stub.sh"
    stub.write_text(
        "#!/usr/bin/env bash\n"
        f"{{\n"
        f"  echo \"CLAUDE_CODE_OAUTH_TOKEN=${{CLAUDE_CODE_OAUTH_TOKEN:-}}\"\n"
        f"  echo \"ANTHROPIC_API_KEY=${{ANTHROPIC_API_KEY:-}}\"\n"
        f"}} > {tmp_path}/claude_env_dump.txt\n"
        f"exit 0\n"
    )
    stub.chmod(0o755)
    return stub


def _read_env_dump(tmp_path: Path) -> dict[str, str]:
    dump = tmp_path / "claude_env_dump.txt"
    assert dump.exists(), "claude stub did not write env dump"
    out: dict[str, str] = {}
    for line in dump.read_text().splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            out[k] = v
    return out


def test_oauth_token_routed_to_correct_env_var(tmp_path):
    """A `sk-ant-oat01-…` value in .env must export
    CLAUDE_CODE_OAUTH_TOKEN (and clear ANTHROPIC_API_KEY) before
    `claude` runs. This is the Cycle β core fix for the keychain
    ACL block under launchd."""
    fake_token = "sk-ant-oat01-FAKE-TEST-TOKEN-DO-NOT-USE"
    _seed_repo(tmp_path)
    # Note: this `.env` is INSIDE the tmp_path (the per-test repo
    # root), NOT the real repo's .env. §0 rule 3 is honored — the
    # test never reads or writes the live ~/projects/claude-code-247
    # .env at any point.
    (tmp_path / ".env").write_text(
        f"# fake test .env\nANTHROPIC_API_KEY={fake_token}\n"
    )
    stub = _env_dumping_claude_stub(tmp_path)
    # Pre-set ANTHROPIC_API_KEY in the env to verify it gets cleared
    # when an oat01 token is loaded from .env.
    r = _run_wake(
        tmp_path,
        extra_env={
            "AUTODEV_CLAUDE_BIN": str(stub),
            "ANTHROPIC_API_KEY": "stale-value-must-be-cleared",
        },
    )
    assert r.returncode == 0
    env = _read_env_dump(tmp_path)
    assert env["CLAUDE_CODE_OAUTH_TOKEN"] == fake_token, (
        f"oat01 token should route to CLAUDE_CODE_OAUTH_TOKEN; "
        f"got {env}"
    )
    assert env["ANTHROPIC_API_KEY"] == "", (
        f"ANTHROPIC_API_KEY should be cleared when oat01 routed; "
        f"got {env['ANTHROPIC_API_KEY']!r}"
    )


def test_api_key_routed_correctly(tmp_path):
    """A `sk-ant-api03-…` value in .env must export ANTHROPIC_API_KEY
    (and NOT touch CLAUDE_CODE_OAUTH_TOKEN). This branch is for
    operators who run the system with a real API key rather than an
    OAuth token — same .env line, prefix discriminates."""
    fake_token = "sk-ant-api03-FAKE-TEST-KEY-DO-NOT-USE"
    _seed_repo(tmp_path)
    (tmp_path / ".env").write_text(
        f"ANTHROPIC_API_KEY={fake_token}\n"
    )
    stub = _env_dumping_claude_stub(tmp_path)
    r = _run_wake(
        tmp_path, extra_env={"AUTODEV_CLAUDE_BIN": str(stub)},
    )
    assert r.returncode == 0
    env = _read_env_dump(tmp_path)
    assert env["ANTHROPIC_API_KEY"] == fake_token, (
        f"api03 key should route to ANTHROPIC_API_KEY; got {env}"
    )
    assert env["CLAUDE_CODE_OAUTH_TOKEN"] == "", (
        f"CLAUDE_CODE_OAUTH_TOKEN should not be set for api03; "
        f"got {env['CLAUDE_CODE_OAUTH_TOKEN']!r}"
    )


def test_no_env_file_falls_back_to_environment(tmp_path):
    """No `.env` in the repo root → the wake script leaves the
    pre-existing environment alone. Operators who source their
    token in launchd plist EnvironmentVariables (instead of .env)
    must not have it clobbered."""
    pre_existing_token = "sk-ant-api03-FROM-PLIST-ENV"
    _seed_repo(tmp_path)
    # Deliberately do NOT write .env
    assert not (tmp_path / ".env").exists()
    stub = _env_dumping_claude_stub(tmp_path)
    r = _run_wake(
        tmp_path,
        extra_env={
            "AUTODEV_CLAUDE_BIN": str(stub),
            "ANTHROPIC_API_KEY": pre_existing_token,
        },
    )
    assert r.returncode == 0
    env = _read_env_dump(tmp_path)
    assert env["ANTHROPIC_API_KEY"] == pre_existing_token, (
        f"pre-existing ANTHROPIC_API_KEY should pass through when "
        f"no .env file is present; got {env}"
    )
