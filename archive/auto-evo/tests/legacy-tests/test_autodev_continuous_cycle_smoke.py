"""End-to-end smoke test for scripts/autodev_continuous_cycle.sh.

The unit tests in tests/test_autodev_continuous_cycle.py cover each
branch of the wake script in isolation. This file's tests run the
wake script multiple times in sequence with the on-disk state
changing between wakes — exercising the actual state machine that
launchd would exercise in production.

Five scenarios, each a single test function:
  1. bootstrap → cooldown → dispatch
  2. rate-limit detect → wait → cleanup → dispatch
  3. target-L reached → AUTODEV_DONE.md written → subsequent skips
  4. BLOCKED → unblock → dispatch
  5. STOPSWITCH → remove → dispatch

The wake script is invoked with AUTODEV_REPO_ROOT pointed at tmp_path
and a stub claude binary. Each test is self-contained.
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


def _seed(tmp_path: Path, *,
          level_overall: int = 4,
          health: int = 100) -> None:
    """Lay down the minimum state the wake script expects."""
    (tmp_path / "reports" / "runs").mkdir(parents=True, exist_ok=True)
    (tmp_path / "scripts").mkdir(parents=True, exist_ok=True)
    (tmp_path / "scripts" / "autodev_cycle_prompt.md").write_text(
        "Stub cycle prompt.\n"
    )
    (tmp_path / "reports" / "health.json").write_text(
        json.dumps({"score": health}) + "\n"
    )
    (tmp_path / "LEVEL.md").write_text(
        f"# LEVEL.md\n\nOverall L = {level_overall}\n"
    )


def _stub_claude(tmp_path: Path, *, output: str = "",
                 exit_code: int = 0) -> Path:
    """Stub claude binary that records its invocation and exits."""
    stub = tmp_path / "claude_stub.sh"
    stub.write_text(
        "#!/usr/bin/env bash\n"
        f"echo \"called: $@\" >> {tmp_path}/claude_invocations.log\n"
        f"echo '{output}'\n"
        f"exit {exit_code}\n"
    )
    stub.chmod(0o755)
    return stub


def _run_wake(tmp_path: Path, *,
              target_l: int = 5,
              claude_stub: Path | None = None,
              extra_env: dict | None = None,
              timeout: int = 30) -> subprocess.CompletedProcess:
    env = os.environ.copy()
    env["AUTODEV_REPO_ROOT"] = str(tmp_path)
    env["AUTODEV_TARGET_L"] = str(target_l)
    if claude_stub is None:
        claude_stub = _stub_claude(tmp_path)
    env["AUTODEV_CLAUDE_BIN"] = str(claude_stub)
    if extra_env:
        env.update({k: str(v) for k, v in extra_env.items()})
    return subprocess.run(
        [str(SCRIPT)], capture_output=True, text=True, env=env,
        timeout=timeout,
    )


def _invocation_count(tmp_path: Path) -> int:
    log = tmp_path / "claude_invocations.log"
    if not log.exists():
        return 0
    return len([line for line in log.read_text().splitlines() if line.strip()])


def _fast_forward_last_wake(tmp_path: Path, *, seconds_ago: int) -> None:
    """Rewrite last_wake.ts to N seconds ago, so cooldown elapses."""
    ts = tmp_path / "reports" / "runs" / "last_wake.ts"
    ts.write_text(str(int(time.time() - seconds_ago)) + "\n")


# --- Scenario 1: bootstrap → cooldown → dispatch -----------------------


def test_smoke_scenario_1_bootstrap_cooldown_dispatch(tmp_path):
    """Wake 1 dispatches; wake 2 (within cooldown) skips; wake 3
    (cooldown elapsed) dispatches again."""
    _seed(tmp_path)

    # Wake 1: fresh, no last_wake.ts → should dispatch
    r1 = _run_wake(tmp_path)
    assert r1.returncode == 0
    assert _invocation_count(tmp_path) == 1, (
        "wake 1 should invoke claude exactly once"
    )
    assert (tmp_path / "reports" / "runs" / "last_wake.ts").exists()

    # Wake 2: last_wake.ts < 5min old → should skip
    r2 = _run_wake(tmp_path)
    assert r2.returncode == 0
    assert _invocation_count(tmp_path) == 1, (
        "wake 2 within cooldown should NOT invoke claude"
    )

    # Wake 3: fast-forward last_wake.ts to 10 min ago → should dispatch
    _fast_forward_last_wake(tmp_path, seconds_ago=600)
    r3 = _run_wake(tmp_path)
    assert r3.returncode == 0
    assert _invocation_count(tmp_path) == 2, (
        "wake 3 after cooldown should invoke claude"
    )


# --- Scenario 2: rate-limit → wait → cleanup → dispatch ----------------


def test_smoke_scenario_2_rate_limit_cycle(tmp_path):
    """Wake 1: claude returns rate-limit message → backoff stamp.
    Wake 2: stamp active → skip.
    Wake 3: stamp expired → cleanup + dispatch."""
    _seed(tmp_path)

    # Wake 1: claude emits a rate-limit message
    rate_limit_stub = _stub_claude(
        tmp_path, output="ERROR: rate limit exceeded, 429"
    )
    r1 = _run_wake(tmp_path, claude_stub=rate_limit_stub)
    assert r1.returncode == 0
    quota_file = tmp_path / "reports" / "quota-rate-limit-until.ts"
    assert quota_file.exists(), (
        "wake 1 should write quota-rate-limit-until.ts after rate-limit "
        "detection"
    )
    until = int(quota_file.read_text().strip())
    assert until > int(time.time()), (
        "backoff stamp should be in the future"
    )

    # Fast-forward last_wake.ts so the cooldown doesn't mask the rate-limit
    _fast_forward_last_wake(tmp_path, seconds_ago=600)

    # Wake 2: rate-limit still active → should skip
    invocations_before = _invocation_count(tmp_path)
    r2 = _run_wake(tmp_path)
    assert r2.returncode == 0
    assert _invocation_count(tmp_path) == invocations_before, (
        "wake 2 while rate-limit active should NOT invoke claude"
    )
    assert quota_file.exists(), (
        "rate-limit stamp must NOT be deleted while still active"
    )

    # Wake 3: rewrite the rate-limit stamp into the past
    quota_file.write_text(str(int(time.time() - 60)) + "\n")
    _fast_forward_last_wake(tmp_path, seconds_ago=600)
    r3 = _run_wake(tmp_path)
    assert r3.returncode == 0
    assert _invocation_count(tmp_path) == invocations_before + 1, (
        "wake 3 after rate-limit expired should invoke claude"
    )
    assert not quota_file.exists(), (
        "expired rate-limit stamp should be cleaned up by the wake script"
    )


# --- Scenario 3: target-L reached → AUTODEV_DONE → skips ---------------


def test_smoke_scenario_3_target_l_reached_done_md_writes_and_holds(tmp_path):
    """Wake 1 with LEVEL.md=5 and target_l=5: should write AUTODEV_DONE.md
    and not invoke claude. Subsequent wakes skip even after time passes.

    Cycle ε changed the default to require 5 consecutive at-target
    cycles. This smoke test's intent is the end-to-end DONE.md
    write path, so it sets AUTODEV_SKIP_STABILITY_GATE=1 (the
    emergency-stop env) to keep the one-shot trip behavior under
    test. The 5-cycle stability path is exercised by
    test_five_consecutive_at_target_writes_done in the unit suite.
    """
    _seed(tmp_path, level_overall=5)
    skip_gate = {"AUTODEV_SKIP_STABILITY_GATE": "1"}

    r1 = _run_wake(tmp_path, target_l=5, extra_env=skip_gate)
    assert r1.returncode == 0
    done = tmp_path / "reports" / "AUTODEV_DONE.md"
    assert done.exists(), "wake 1 should write AUTODEV_DONE.md at target"
    assert _invocation_count(tmp_path) == 0, (
        "wake at target-L must NOT invoke claude"
    )

    # Wake 2: fast-forward cooldown, AUTODEV_DONE still present → skip
    _fast_forward_last_wake(tmp_path, seconds_ago=600)
    r2 = _run_wake(tmp_path, target_l=5, extra_env=skip_gate)
    assert r2.returncode == 0
    assert _invocation_count(tmp_path) == 0, (
        "wake 2 with AUTODEV_DONE present should NOT invoke claude"
    )

    # Wake 3: remove AUTODEV_DONE, LEVEL.md still says 5 → should
    # re-write AUTODEV_DONE.md (emergency-stop env still set).
    done.unlink()
    _fast_forward_last_wake(tmp_path, seconds_ago=600)
    r3 = _run_wake(tmp_path, target_l=5, extra_env=skip_gate)
    assert r3.returncode == 0
    assert done.exists(), (
        "wake 3 should re-write AUTODEV_DONE.md if target-L still reached"
    )
    assert _invocation_count(tmp_path) == 0


# --- Scenario 4: BLOCKED → unblock → dispatch --------------------------


def test_smoke_scenario_4_blocked_then_unblock(tmp_path):
    """Wake 1 with fresh BLOCKED.md → skip.
    Wake 2 after BLOCKED.md removed → dispatch."""
    _seed(tmp_path)
    blocked = tmp_path / "BLOCKED.md"
    blocked.write_text("blocked\n")
    # 1 minute old → under 24h → wake script skips
    os.utime(blocked, (time.time() - 60,) * 2)

    r1 = _run_wake(tmp_path)
    assert r1.returncode == 0
    assert _invocation_count(tmp_path) == 0, (
        "wake 1 with BLOCKED.md (<24h) should NOT invoke claude"
    )

    # Wake 2: remove BLOCKED.md → should dispatch
    blocked.unlink()
    r2 = _run_wake(tmp_path)
    assert r2.returncode == 0
    assert _invocation_count(tmp_path) == 1, (
        "wake 2 after BLOCKED.md removed should invoke claude"
    )


# --- Scenario 5: STOPSWITCH → remove → dispatch ------------------------


def test_smoke_scenario_5_stopswitch_then_resume(tmp_path):
    """Wake 1 with STOPSWITCH → skip.
    Wake 2 after STOPSWITCH removed → dispatch."""
    _seed(tmp_path)
    switch = tmp_path / "reports" / "STOPSWITCH"
    switch.write_text("halt\n")

    r1 = _run_wake(tmp_path)
    assert r1.returncode == 0
    assert _invocation_count(tmp_path) == 0, (
        "wake 1 with STOPSWITCH should NOT invoke claude"
    )

    switch.unlink()
    r2 = _run_wake(tmp_path)
    assert r2.returncode == 0
    assert _invocation_count(tmp_path) == 1, (
        "wake 2 after STOPSWITCH removed should invoke claude"
    )


# --- Invariant across all scenarios ------------------------------------


def test_smoke_wake_always_exits_0_no_matter_what(tmp_path):
    """All wake invocations across all states MUST exit 0 — otherwise
    launchd would enter ThrottleInterval."""
    _seed(tmp_path)

    # Variant 1: claude returns non-zero
    failing_stub = _stub_claude(tmp_path, exit_code=42)
    r = _run_wake(tmp_path, claude_stub=failing_stub)
    assert r.returncode == 0, "wake must exit 0 even when claude fails"

    # Variant 2: AUTODEV_DONE active
    (tmp_path / "reports" / "AUTODEV_DONE.md").write_text("done\n")
    r = _run_wake(tmp_path)
    assert r.returncode == 0

    # Variant 3: STOPSWITCH active
    (tmp_path / "reports" / "AUTODEV_DONE.md").unlink()
    (tmp_path / "reports" / "STOPSWITCH").write_text("halt\n")
    r = _run_wake(tmp_path)
    assert r.returncode == 0

    # Variant 4: health < 50
    (tmp_path / "reports" / "STOPSWITCH").unlink()
    (tmp_path / "reports" / "health.json").write_text(
        json.dumps({"score": 30}) + "\n"
    )
    r = _run_wake(tmp_path)
    assert r.returncode == 0


# --- Multi-cycle dispatch counts last_wake.ts updates ------------------


def test_smoke_last_wake_ts_advances_each_dispatch(tmp_path):
    """Across multiple dispatches, last_wake.ts should advance (not
    just stay at the first wake)."""
    _seed(tmp_path)

    r1 = _run_wake(tmp_path)
    assert r1.returncode == 0
    ts_after_wake_1 = int(
        (tmp_path / "reports" / "runs" / "last_wake.ts").read_text().strip()
    )

    # Brief pause to ensure ts can change
    time.sleep(1.1)
    _fast_forward_last_wake(tmp_path, seconds_ago=600)
    # Restore the seed (overwritten by fast-forward but the wake should
    # update it to "now")
    r2 = _run_wake(tmp_path)
    assert r2.returncode == 0
    ts_after_wake_2 = int(
        (tmp_path / "reports" / "runs" / "last_wake.ts").read_text().strip()
    )
    assert ts_after_wake_2 > ts_after_wake_1, (
        f"last_wake.ts must advance across dispatches "
        f"({ts_after_wake_1} → {ts_after_wake_2})"
    )
