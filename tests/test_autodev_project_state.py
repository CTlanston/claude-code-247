"""ProjectState tests."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from autodev.project_state import ProjectState, SCHEMA_DEFAULTS


def test_load_missing_file_creates_defaults(tmp_path: Path):
    p = tmp_path / "state.json"
    s = ProjectState.load(path=p)
    assert p.exists()
    assert s["version"] == 1
    assert s["mode"] == "cheap"
    assert s["paused"] is False


def test_load_valid_file_merges_with_defaults(tmp_path: Path):
    p = tmp_path / "state.json"
    p.write_text(json.dumps({"mode": "balanced", "current_task_id": "T1"}))
    s = ProjectState.load(path=p)
    assert s["mode"] == "balanced"
    assert s["current_task_id"] == "T1"
    # Default fields are still present.
    assert s["paused"] is False
    assert s["live_allowed"] is False


def test_corrupt_file_is_backed_up_and_reinitialised(tmp_path: Path):
    p = tmp_path / "state.json"
    p.write_text("{not valid json")
    s = ProjectState.load(path=p)
    # Reinitialised → default mode
    assert s["mode"] == "cheap"
    # Backup file exists.
    backups = list(tmp_path.glob("state.corrupt.*.json"))
    assert backups, f"no backup created in {tmp_path}"


def test_save_is_atomic(tmp_path: Path):
    p = tmp_path / "state.json"
    s = ProjectState(path=p)
    s["current_task_id"] = "T2"
    s.save()
    data = json.loads(p.read_text())
    assert data["current_task_id"] == "T2"
    assert data["updated_at"] is not None
    # No `.tmp` leftover
    assert not (tmp_path / "state.json.tmp").exists()


def test_context_manager_saves_on_clean_exit(tmp_path: Path):
    p = tmp_path / "state.json"
    with ProjectState(path=p) as s:
        s["current_phase"] = "coding"
    data = json.loads(p.read_text())
    assert data["current_phase"] == "coding"


def test_context_manager_does_not_save_on_exception(tmp_path: Path):
    p = tmp_path / "state.json"
    # Seed with known content
    ProjectState(path=p).save()
    initial = json.loads(p.read_text())
    with pytest.raises(RuntimeError):
        with ProjectState(path=p) as s:
            s["current_phase"] = "would_lose"
            raise RuntimeError("simulated crash")
    # Disk should still match the seed (no mutation persisted)
    after = json.loads(p.read_text())
    assert after["current_phase"] == initial["current_phase"]
