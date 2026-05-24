"""Regression tests for scripts/update_goldens.sh (Track T7 / Cycle 23)."""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "update_goldens.sh"
GOLDEN_DIR = REPO_ROOT / "tests" / "golden"


def test_script_exists_and_executable():
    assert SCRIPT.exists()
    assert os.access(SCRIPT, os.X_OK)


def test_decline_exits_1_no_changes(tmp_path):
    """Operator declines → exit 1 + fixtures unchanged."""
    # Snapshot existing fixtures
    before = {
        f.name: f.read_bytes()
        for f in GOLDEN_DIR.iterdir() if f.is_file()
    }
    result = subprocess.run(
        [str(SCRIPT)], input="n\n", text=True,
        capture_output=True, timeout=15,
    )
    assert result.returncode == 1
    assert "declined" in (result.stdout + result.stderr).lower()
    # Fixtures must be byte-identical
    after = {
        f.name: f.read_bytes()
        for f in GOLDEN_DIR.iterdir() if f.is_file()
    }
    assert before == after


def test_accept_exits_0_fixtures_present(tmp_path):
    """Operator confirms → exit 0 + fixtures regenerated.

    Snapshot the fixtures before; the regenerated content should be
    byte-identical IF the underlying functions haven't changed (which
    they shouldn't have between test setup and test body)."""
    before = {
        f.name: f.read_bytes()
        for f in GOLDEN_DIR.iterdir() if f.is_file()
    }
    result = subprocess.run(
        [str(SCRIPT)], input="y\n", text=True,
        capture_output=True, timeout=30,
    )
    assert result.returncode == 0, (
        f"expected 0, got {result.returncode}\n"
        f"out: {result.stdout}\nerr: {result.stderr}"
    )
    # All fixtures should exist + match the captured baseline
    after = {
        f.name: f.read_bytes()
        for f in GOLDEN_DIR.iterdir() if f.is_file()
    }
    for name in before:
        assert name in after, f"fixture {name} was lost"
        # Bytes should match (deterministic regeneration)
        assert before[name] == after[name], (
            f"fixture {name} changed unexpectedly during regen"
        )


def test_empty_input_treated_as_decline():
    """Just hitting Enter (empty response) → decline → exit 1."""
    result = subprocess.run(
        [str(SCRIPT)], input="\n", text=True,
        capture_output=True, timeout=15,
    )
    assert result.returncode == 1


def test_uppercase_yes_accepted():
    """`YES` (uppercase) should accept; case-insensitive prompt match."""
    result = subprocess.run(
        [str(SCRIPT)], input="YES\n", text=True,
        capture_output=True, timeout=30,
    )
    assert result.returncode == 0
