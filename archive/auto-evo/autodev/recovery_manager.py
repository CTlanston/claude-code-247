"""RecoveryManager — pick the next safe action after a restart.

Reads ProjectState + the hold/blocker files and returns one of:

  continue_current_task     resume the task in tasks/current.md
  select_new_task            pick from tasks/backlog.md
  pause                      paused=true, do nothing
  hold_for_human             critical blocker; emit report and exit
  repair_state               state.json was just reinitialised; bootstrap
  report_only                supervisor was asked /report — write daily.md, exit

The supervisor calls `RecoveryManager.decide_next_action()` once per cycle,
acts on the returned value, then writes a new state.

This module is deliberately decoupled from the execution layer — it never
imports the inner engine, the CLI executor, or anything that does I/O
beyond reading filesystem state. That keeps it testable and keeps the
supervisor's decision logic transparent.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Optional

from .project_state import ProjectState


class RecoveryAction(str, Enum):
    CONTINUE_CURRENT = "continue_current_task"
    SELECT_NEW = "select_new_task"
    PAUSE = "pause"
    HOLD_FOR_HUMAN = "hold_for_human"
    REPAIR_STATE = "repair_state"
    REPORT_ONLY = "report_only"


@dataclass
class RecoveryDecision:
    action: RecoveryAction
    reason: str
    detail: Optional[str] = None


class RecoveryManager:
    """Decide what the supervisor should do on this cycle.

    No I/O beyond filesystem reads.  Pure-ish — call site is responsible for
    acting on the decision and updating state."""

    CRITICAL_BLOCKER_CATEGORIES = {"auth", "secret", "permission", "safety"}

    def __init__(
        self,
        state: ProjectState,
        *,
        report_only: bool = False,
        hold_file: Optional[Path] = None,
        current_task_file: Optional[Path] = None,
    ):
        self.state = state
        self._report_only = report_only
        self._hold_file = hold_file
        self._current_task_file = current_task_file

    def decide_next_action(self) -> RecoveryDecision:
        # Caller can force a report-only cycle (e.g. /report command).
        if self._report_only:
            return RecoveryDecision(
                RecoveryAction.REPORT_ONLY,
                "explicit /report request",
            )

        # Paused trumps everything except report.
        if self.state["paused"]:
            return RecoveryDecision(
                RecoveryAction.PAUSE,
                "state.paused=true",
            )

        # Critical hold items → halt; non-critical → continue with next task.
        critical = self._has_critical_blocker()
        if critical:
            return RecoveryDecision(
                RecoveryAction.HOLD_FOR_HUMAN,
                "critical blocker present",
                detail=critical,
            )

        # State just reinitialised (e.g. after corruption recovery).
        if self.state["health_status"] in ("bootstrap", "unknown"):
            return RecoveryDecision(
                RecoveryAction.REPAIR_STATE,
                "state was reinitialised or never bootstrapped",
            )

        # Have an active task → continue.
        if self.state["current_task_id"] and not self.state["blocked"]:
            return RecoveryDecision(
                RecoveryAction.CONTINUE_CURRENT,
                f"task {self.state['current_task_id']} is active",
            )

        # Nothing else applies → pick fresh work.
        return RecoveryDecision(
            RecoveryAction.SELECT_NEW,
            "no current task and not paused; selecting from backlog",
        )

    # ----- helpers --------------------------------------------------------

    def _has_critical_blocker(self) -> Optional[str]:
        """Read `reports/human-hold.md` and return the first critical entry's
        title, or None if no critical entries are present."""
        if self._hold_file is None:
            return None
        if not self._hold_file.exists():
            return None
        try:
            text = self._hold_file.read_text()
        except OSError:
            return None
        # Look for `- Severity: critical` lines inside `## HOLD-N` blocks.
        # A simple line-scan is sufficient — the file is small.
        lines = text.splitlines()
        current_title = None
        for line in lines:
            stripped = line.strip()
            if stripped.startswith("## HOLD-"):
                current_title = stripped.lstrip("# ").strip()
            elif current_title and stripped.lower().startswith("- severity:") and "critical" in stripped.lower():
                return current_title
        return None
