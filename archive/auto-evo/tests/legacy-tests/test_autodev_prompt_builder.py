"""PromptBuilder tests."""
from __future__ import annotations

from pathlib import Path

from autodev.project_state import ProjectState
from autodev.prompt_builder import PromptBuilder


def _state(**kw) -> ProjectState:
    s = ProjectState()
    for k, v in kw.items():
        s[k] = v
    return s


def test_basic_prompt_contains_essentials():
    s = _state(cost_mode="cheap", current_task_id="TASK-001",
               current_task_title="example", current_phase="coding")
    out = PromptBuilder(s).build(
        task_title="example", task_details="do x", last_error=None,
    )
    assert "AutoDev v3" in out
    assert "Policy" in out
    assert "TASK-001" in out
    assert "Hold-on protocol" in out


def test_last_error_section_included():
    s = _state(cost_mode="cheap")
    out = PromptBuilder(s).build(
        task_title="t", task_details="d",
        last_error="ruff: F401 unused import logging",
    )
    assert "Last failure feedback" in out
    assert "F401" in out


def test_prompt_truncation_caps_size():
    s = _state(cost_mode="cheap")
    huge = "A" * 50_000
    out = PromptBuilder(s).build(
        task_title="t", task_details=huge, last_error=huge,
    )
    # Hard ceiling enforced
    assert len(out) <= 9000


def test_prompt_omits_error_section_when_none():
    s = _state(cost_mode="cheap")
    out = PromptBuilder(s).build(task_title="t", task_details="d")
    assert "Last failure feedback" not in out
