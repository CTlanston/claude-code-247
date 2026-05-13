"""Cycle 40 — wake script refreshes health before reading.

Cycles 37-39 set up the health pipeline:
  37 — orchestrator/health.py emits the score
  38 — doctor reads health.json (read-only)
  39 — health.{json,md,history.jsonl} gitignored so wake-refresh
       doesn't dirty the tree

This cycle wires the wake script to call autodev_health.sh before
reading reports/health.json, so the file is always fresh per
dispatch decision.

Tests pin: (a) the refresh source change is present, (b) the
refresh actually invokes the health script, (c) the
AUTODEV_SKIP_HEALTH_REFRESH env-var disables it, (d) fail-open
on missing/failed health emitter, (e) FAIL-0009 invariant
preserved (no dirty tracked tree).
"""
from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
WAKE = REPO_ROOT / "scripts" / "autodev_continuous_cycle.sh"


def _seed_repo(tmp_path: Path, *,
               level_overall: int = 4,
               with_health_json: int | None = None) -> None:
    """Lay down the minimum state a wake-script invocation needs."""
    (tmp_path / "reports" / "runs").mkdir(parents=True, exist_ok=True)
    (tmp_path / "scripts").mkdir(parents=True, exist_ok=True)
    (tmp_path / "scripts" / "autodev_cycle_prompt.md").write_text("stub\n")
    (tmp_path / "LEVEL.md").write_text(
        f"# LEVEL.md\n\nOverall L = {level_overall}\n"
    )
    if with_health_json is not None:
        (tmp_path / "reports" / "health.json").write_text(
            json.dumps({"score": with_health_json, "status": "n/a"}) + "\n"
        )


def _stub_claude(tmp_path: Path) -> Path:
    stub = tmp_path / "claude_stub.sh"
    stub.write_text(
        "#!/usr/bin/env bash\n"
        f"echo called > {tmp_path}/claude_invoked.log\n"
        "exit 0\n"
    )
    stub.chmod(0o755)
    return stub


def _stub_health(tmp_path: Path, *, score: int = 100) -> Path:
    """Plant a stub autodev_health.sh that records its invocation
    and emits a controllable score."""
    health = tmp_path / "scripts" / "autodev_health.sh"
    health.write_text(
        "#!/usr/bin/env bash\n"
        f"echo called > {tmp_path}/health_invoked.log\n"
        f"mkdir -p {tmp_path}/reports\n"
        f"cat > {tmp_path}/reports/health.json <<'EOF'\n"
        + json.dumps({"score": score, "status": "stub"}) + "\n"
        "EOF\n"
        "exit 0\n"
    )
    health.chmod(0o755)
    return health


def _run_wake(tmp_path: Path, *,
              skip_refresh: bool = False,
              claude_stub: Path | None = None,
              ) -> subprocess.CompletedProcess:
    env = os.environ.copy()
    env["AUTODEV_REPO_ROOT"] = str(tmp_path)
    env["AUTODEV_TARGET_L"] = "5"
    env["AUTODEV_CLAUDE_BIN"] = str(claude_stub or _stub_claude(tmp_path))
    if skip_refresh:
        env["AUTODEV_SKIP_HEALTH_REFRESH"] = "1"
    return subprocess.run(
        [str(WAKE)], capture_output=True, text=True, env=env,
        timeout=30,
    )


# --- Source-level pins ----------------------------------------------


def test_wake_source_invokes_health_refresh():
    """The wake-script source must contain an `autodev_health.sh`
    invocation."""
    src = WAKE.read_text(encoding="utf-8")
    assert "autodev_health.sh" in src, (
        "wake script must invoke scripts/autodev_health.sh to refresh "
        "health.json before reading the score"
    )


def test_wake_source_has_skip_refresh_env_var():
    """The wake script must honor AUTODEV_SKIP_HEALTH_REFRESH=1."""
    src = WAKE.read_text(encoding="utf-8")
    assert "AUTODEV_SKIP_HEALTH_REFRESH" in src


def test_wake_source_refresh_is_fail_open():
    """The refresh invocation must use `|| true` (fail-open) so a
    broken health emitter doesn't abort the wake."""
    src = WAKE.read_text(encoding="utf-8")
    # Find the autodev_health.sh line; verify the trailing safety
    # pattern is present in nearby text.
    health_idx = src.find("autodev_health.sh")
    window = src[health_idx:health_idx + 300]
    assert "|| true" in window or "|| :" in window, (
        f"the autodev_health.sh invocation must be guarded with "
        f"`|| true` or `|| :` so a failure doesn't abort the wake; "
        f"window: {window!r}"
    )


# --- Runtime: stub captures invocation ------------------------------


def test_wake_invokes_health_stub(tmp_path):
    """When a stub autodev_health.sh exists in the repo, the wake
    script should invoke it before reading reports/health.json."""
    _seed_repo(tmp_path)
    _stub_health(tmp_path, score=100)
    r = _run_wake(tmp_path)
    assert r.returncode == 0
    log = tmp_path / "health_invoked.log"
    assert log.exists(), (
        "stub autodev_health.sh was NOT invoked by the wake script"
    )


def test_wake_skip_refresh_env_var_works(tmp_path):
    """AUTODEV_SKIP_HEALTH_REFRESH=1 must bypass the refresh."""
    _seed_repo(tmp_path, with_health_json=100)
    _stub_health(tmp_path, score=42)
    r = _run_wake(tmp_path, skip_refresh=True)
    assert r.returncode == 0
    log = tmp_path / "health_invoked.log"
    assert not log.exists(), (
        "AUTODEV_SKIP_HEALTH_REFRESH=1 did NOT bypass the refresh"
    )


def test_wake_uses_refreshed_score_for_health_gate(tmp_path):
    """If the stub health emitter writes score=42 (< 50), the wake
    script reads it and SKIPS dispatch."""
    _seed_repo(tmp_path)
    _stub_health(tmp_path, score=42)
    stub_claude = _stub_claude(tmp_path)
    r = _run_wake(tmp_path, claude_stub=stub_claude)
    assert r.returncode == 0
    # claude must NOT have been invoked — health < 50 → skip
    assert not (tmp_path / "claude_invoked.log").exists(), (
        "wake invoked claude despite health=42 < 50"
    )


def test_wake_proceeds_when_health_emitter_missing(tmp_path):
    """If autodev_health.sh is absent from the tmp repo's scripts/
    directory, the wake script's `|| true` guard must keep it
    proceeding without crashing."""
    _seed_repo(tmp_path)
    # NOTE: deliberately NOT planting _stub_health
    r = _run_wake(tmp_path)
    assert r.returncode == 0, (
        f"wake should not crash when autodev_health.sh missing; "
        f"stderr: {r.stderr[-300:]}"
    )


# --- FAIL-0009 invariant -------------------------------------------


def test_wake_health_refresh_leaves_real_tree_clean():
    """When the wake runs in the real repo (which has the real
    autodev_health.sh and gitignored health artifacts), no new
    tracked-file mods appear in git status."""
    # Snapshot the porcelain BEFORE
    def porcelain() -> set:
        r = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=REPO_ROOT, capture_output=True, text=True, timeout=10,
        )
        return set(l for l in r.stdout.splitlines() if l.strip())
    before = porcelain()
    # Run the REAL autodev_health.sh (simulates what the wake will do)
    subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "autodev_health.sh")],
        cwd=REPO_ROOT, capture_output=True, text=True, timeout=60,
    )
    after = porcelain()
    new = after - before
    # No new health-file entries should appear (gitignored)
    health_paths = ("reports/health.json", "reports/health.md",
                    "reports/health.history.jsonl")
    bad = [line for line in new if any(p in line for p in health_paths)]
    assert not bad, (
        f"health refresh leaked into git status: {bad}. The "
        f"FAIL-0009-class invariant is broken; check .gitignore."
    )
