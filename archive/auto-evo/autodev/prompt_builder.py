"""PromptBuilder — produce a compact recovery prompt.

The prompt is what gets fed to the Claude Code CLI when the supervisor wants
to "continue the work". It must contain everything an amnesiac Claude
session needs:

  * repo policy (CLAUDE.md TL;DR)
  * cost mode + non-negotiables
  * current state.json fields the agent should care about
  * the current task (or the next task from backlog)
  * the most recent test/CI/Guardian outcome
  * the hold-on protocol so the agent doesn't burn cycles when blocked

Output is kept short — large prompts cost more and slow down the loop. The
ceiling is roughly 6KB; the builder trims sections by recency if it overflows.
"""
from __future__ import annotations

import time
from pathlib import Path
from typing import Optional

from .project_state import ProjectState


def _project_root() -> Path:
    return Path(__file__).resolve().parent.parent


# Max characters per section; keeps the total prompt manageable.
_MAX_SESSION_LOG_CHARS = 1500
_MAX_TASK_DETAILS_CHARS = 800
_MAX_LAST_ERROR_CHARS = 1200
_MAX_TOTAL_CHARS = 8000


def _read_truncated(path: Path, max_chars: int) -> str:
    if not path.exists():
        return ""
    try:
        text = path.read_text()
    except OSError:
        return ""
    if len(text) <= max_chars:
        return text
    # Prefer the tail for log-like content.
    return "...[truncated]...\n" + text[-max_chars:]


class PromptBuilder:
    def __init__(self, state: ProjectState):
        self.state = state

    def build(
        self,
        *,
        task_title: Optional[str] = None,
        task_details: Optional[str] = None,
        last_error: Optional[str] = None,
    ) -> str:
        parts: list[str] = []
        parts.append(self._header())
        parts.append(self._policy_section())
        parts.append(self._state_section())
        parts.append(self._task_section(task_title, task_details))
        if last_error:
            parts.append(self._error_section(last_error))
        parts.append(self._session_log_section())
        parts.append(self._hold_protocol_section())
        out = "\n\n".join(p for p in parts if p)
        if len(out) > _MAX_TOTAL_CHARS:
            out = out[:_MAX_TOTAL_CHARS] + "\n\n[truncated to keep prompt small]"
        return out

    # ----- sections ------------------------------------------------------

    def _header(self) -> str:
        ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        return (
            f"# AutoDev v3 supervisor — recovery prompt\n"
            f"Generated: {ts}\n"
            f"Cost mode: {self.state['cost_mode']}  "
            f"Live: {self.state['live_allowed']}  "
            f"Autostart: {self.state['autostart_allowed']}"
        )

    def _policy_section(self) -> str:
        return (
            "## Policy\n"
            "- This repo has both an Auto-Evo inner engine (orchestrator/) and "
            "an AutoDev v3 outer loop (autodev/). Do NOT rewrite the inner engine.\n"
            "- Never push to `main`. Never auto-merge PRs. Never edit `.env`.\n"
            "- If the cost mode is `cheap` (current: " + str(self.state['cost_mode']) + "), "
            "do NOT call the Anthropic SDK/API; use the Claude Code CLI/subscription only.\n"
            "- Make one coherent increment per cycle. Small commits beat large ones."
        )

    def _state_section(self) -> str:
        s = self.state
        lines = ["## Supervisor state"]
        for key in (
            "current_task_id", "current_task_title", "current_phase",
            "branch", "last_test_result", "last_ci_result",
            "last_guardian_result", "blocked", "blocker_reason",
            "repair_attempts_for_current_task",
        ):
            if s[key] is not None:
                lines.append(f"- {key}: {s[key]}")
        return "\n".join(lines)

    def _task_section(self, title: Optional[str], details: Optional[str]) -> str:
        title = title or self.state["current_task_title"]
        if not title and not details:
            # Pull from tasks/current.md as last resort
            cur = _project_root() / "tasks" / "current.md"
            current_text = _read_truncated(cur, _MAX_TASK_DETAILS_CHARS)
            return "## Current task\n\n" + (current_text or "(no task)")
        out = ["## Current task"]
        if title:
            out.append(f"**Title:** {title}")
        if details:
            details_trim = details[:_MAX_TASK_DETAILS_CHARS]
            out.append(f"\n{details_trim}")
        return "\n".join(out)

    def _error_section(self, last_error: str) -> str:
        return (
            "## Last failure feedback\n"
            "Read this carefully — fix the SPECIFIC issue, do not retry blindly.\n\n"
            "```\n"
            f"{last_error[:_MAX_LAST_ERROR_CHARS]}\n"
            "```"
        )

    def _session_log_section(self) -> str:
        log = _project_root() / "reports" / "session-log.md"
        tail = _read_truncated(log, _MAX_SESSION_LOG_CHARS)
        if not tail:
            return ""
        return "## Recent session log (tail)\n\n```\n" + tail + "\n```"

    def _hold_protocol_section(self) -> str:
        return (
            "## Hold-on protocol\n"
            "If you cannot finish this task safely:\n"
            "1. Append a `## HOLD-<n>: <title>` entry to `reports/human-hold.md` "
            "with severity, category, what you tried, why you stopped, exact "
            "human action needed.\n"
            "2. Mirror a short pointer to `tasks/blockers.md` and "
            "`reports/session-log.md`.\n"
            "3. Stop THIS task and let the supervisor pick the next one.\n"
            "Do NOT loop on the same error more than 3 times.\n"
            "Do NOT randomly retry. Make one targeted fix per attempt."
        )
