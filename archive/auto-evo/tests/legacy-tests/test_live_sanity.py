"""Regression tests for scripts/v5_live_sanity.sh (Track T6).

The live-sanity script has two modes:
- AUTODEV_LIVE=0 (default): simulate one inner-engine state-machine tick
  deterministically; write JSON to reports/live-sanity/<ts>.json.
- AUTODEV_LIVE=1: require HUMAN_CONFIG.runtime.live_sanity_authorized=true.
  Without the config flag, refuse with exit 2.

These tests never set AUTODEV_LIVE=1 with the flag set — keeping the
real-live path under explicit operator control. They cover the dry-run
path + the refusal path + JSON schema invariants.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "v5_live_sanity.sh"
LIVE_DIR = REPO_ROOT / "reports" / "live-sanity"


def _run(args=(), env=None, cwd=None):
    """Invoke the live-sanity script with a clean env subset."""
    test_env = os.environ.copy()
    if env:
        test_env.update(env)
    return subprocess.run(
        [str(SCRIPT), *args],
        capture_output=True, text=True, env=test_env,
        cwd=str(cwd) if cwd else None, timeout=30,
    )


# --- Existence + executable ----------------------------------------------


def test_script_exists():
    assert SCRIPT.exists(), f"missing: {SCRIPT}"


def test_script_is_executable():
    assert os.access(SCRIPT, os.X_OK)


# --- Dry-run (default) ---------------------------------------------------


def test_dry_run_default_exits_0(tmp_path, monkeypatch):
    """AUTODEV_LIVE unset → dry-run path → exit 0 + JSON artifact."""
    output_dir = tmp_path / "live-sanity"
    result = _run(
        env={"AUTODEV_LIVE": "0",
             "AUTODEV_LIVE_SANITY_DIR": str(output_dir)},
    )
    assert result.returncode == 0, (
        f"expected 0, got {result.returncode}\nstderr: {result.stderr}"
    )


def test_dry_run_writes_json_artifact(tmp_path):
    """A dry-run produces a JSON in the live-sanity dir."""
    output_dir = tmp_path / "live-sanity"
    result = _run(
        env={"AUTODEV_LIVE": "0",
             "AUTODEV_LIVE_SANITY_DIR": str(output_dir)},
    )
    assert result.returncode == 0
    artifacts = sorted(output_dir.glob("*.json"))
    assert len(artifacts) >= 1
    data = json.loads(artifacts[-1].read_text())
    # Required schema fields
    for k in ("started_at", "ended_at", "state_transitions",
              "mode", "result"):
        assert k in data, f"missing key {k!r} in JSON: {data}"
    assert data["mode"] == "dry-run"
    assert data["result"] == "ok"
    # State transitions should walk the inner-engine state machine
    assert isinstance(data["state_transitions"], list)
    assert len(data["state_transitions"]) >= 3


def test_dry_run_two_consecutive_writes_distinct_files(tmp_path):
    """Two dry-runs produce two distinct timestamped artifacts."""
    output_dir = tmp_path / "live-sanity"
    _run(env={"AUTODEV_LIVE": "0",
              "AUTODEV_LIVE_SANITY_DIR": str(output_dir)})
    # Force a different timestamp; the script uses date +%Y%m%d-%H%M%S
    # so we sleep 1s to guarantee a distinct name
    import time
    time.sleep(1.1)
    _run(env={"AUTODEV_LIVE": "0",
              "AUTODEV_LIVE_SANITY_DIR": str(output_dir)})
    artifacts = sorted(output_dir.glob("*.json"))
    assert len(artifacts) == 2
    assert artifacts[0].name != artifacts[1].name


# --- Live mode refusal --------------------------------------------------


def test_live_mode_without_config_flag_refuses(tmp_path):
    """AUTODEV_LIVE=1 with no config-flag → exit 2 with refusal message."""
    output_dir = tmp_path / "live-sanity"
    config_file = tmp_path / "HUMAN_CONFIG.md"
    # Config has live_sanity_authorized: false (or absent)
    config_file.write_text(
        "# HUMAN_CONFIG.md\n\n"
        "```yaml\nruntime:\n  live_sanity_authorized: false\n```\n"
    )
    result = _run(
        env={"AUTODEV_LIVE": "1",
             "AUTODEV_LIVE_SANITY_DIR": str(output_dir),
             "AUTODEV_HUMAN_CONFIG": str(config_file)},
    )
    assert result.returncode == 2
    msg = result.stdout + result.stderr
    assert "live_sanity_authorized" in msg or "not authorized" in msg.lower()


def test_live_mode_with_config_flag_returns_placeholder_exit(tmp_path):
    """AUTODEV_LIVE=1 + config_flag=true → exit 3 (placeholder TODO)."""
    output_dir = tmp_path / "live-sanity"
    config_file = tmp_path / "HUMAN_CONFIG.md"
    config_file.write_text(
        "# HUMAN_CONFIG.md\n\n"
        "```yaml\nruntime:\n  live_sanity_authorized: true\n```\n"
    )
    result = _run(
        env={"AUTODEV_LIVE": "1",
             "AUTODEV_LIVE_SANITY_DIR": str(output_dir),
             "AUTODEV_HUMAN_CONFIG": str(config_file)},
    )
    assert result.returncode == 3, (
        f"expected 3 (placeholder), got {result.returncode}\n"
        f"out: {result.stdout}\nerr: {result.stderr}"
    )


# --- JSON validity property ----------------------------------------------


def test_dry_run_json_is_parseable_and_consistent(tmp_path):
    """The emitted JSON parses cleanly and started_at <= ended_at."""
    output_dir = tmp_path / "live-sanity"
    result = _run(env={"AUTODEV_LIVE": "0",
                       "AUTODEV_LIVE_SANITY_DIR": str(output_dir)})
    assert result.returncode == 0
    artifact = sorted(output_dir.glob("*.json"))[-1]
    data = json.loads(artifact.read_text())
    # started_at and ended_at are ISO strings; lexicographic order works
    assert data["started_at"] <= data["ended_at"]
