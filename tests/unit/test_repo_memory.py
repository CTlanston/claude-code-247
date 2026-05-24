from __future__ import annotations

from pathlib import Path

import pytest

from memory.repo_memory import CANONICAL_FILES, AgentMemory


def test_canonical_files_list_matches_spec() -> None:
    assert "FAILURES" in CANONICAL_FILES
    assert "REVIEW_LESSONS" in CANONICAL_FILES
    assert len(CANONICAL_FILES) == 8


def test_read_returns_empty_for_missing(tmp_path: Path) -> None:
    m = AgentMemory(repo_path=tmp_path)
    assert m.read("FAILURES") == ""


def test_write_creates_dir(tmp_path: Path) -> None:
    m = AgentMemory(repo_path=tmp_path)
    p = m.write("FAILURES", "# fail\n")
    assert p.exists()
    assert (tmp_path / ".agent" / "FAILURES.md").exists()
    assert m.read("FAILURES") == "# fail\n"


def test_append_adds_separator(tmp_path: Path) -> None:
    m = AgentMemory(repo_path=tmp_path)
    m.write("DECISIONS", "first decision")
    m.append("DECISIONS", "second decision")
    body = m.read("DECISIONS")
    assert body == "first decision\n\nsecond decision"


def test_invalid_name_raises(tmp_path: Path) -> None:
    m = AgentMemory(repo_path=tmp_path)
    with pytest.raises(ValueError):
        m.read("NOT_A_REAL_FILE")


def test_initialize_creates_all_canonical_files(tmp_path: Path) -> None:
    m = AgentMemory(repo_path=tmp_path)
    created = m.initialize_if_missing()
    assert len(created) == len(CANONICAL_FILES)
    assert (tmp_path / ".agent" / "FAILURES.md").exists()


def test_initialize_is_idempotent(tmp_path: Path) -> None:
    m = AgentMemory(repo_path=tmp_path)
    m.initialize_if_missing()
    created_again = m.initialize_if_missing()
    assert created_again == []


def test_summary_reports_present_files(tmp_path: Path) -> None:
    m = AgentMemory(repo_path=tmp_path)
    m.write("FAILURES", "x")
    m.write("DECISIONS", "y" * 100)
    s = m.summary()
    assert set(s.keys()) == {"FAILURES", "DECISIONS"}
    assert s["FAILURES"] == 1
    assert s["DECISIONS"] == 100
