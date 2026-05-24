"""ReportManager — generate the report family.

Reports written:
  reports/state.json          (mirror of ProjectState)
  reports/heartbeat.json      (last cycle stamp)
  reports/session-log.md      (append-only)
  reports/daily.md            (rewritten each cycle)
  reports/run-history.md      (one-line append per cycle)
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Optional

from .project_state import ProjectState


def _project_root() -> Path:
    return Path(__file__).resolve().parent.parent


def reports_dir() -> Path:
    return _project_root() / "reports"


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


class ReportManager:
    def __init__(self, state: ProjectState):
        self.state = state

    # ----- entry per cycle -------------------------------------------------

    def cycle_finished(self, *, summary: str, success: bool,
                       task_id: Optional[str], notes: str = "") -> None:
        self._update_heartbeat()
        self._append_session_log(summary, success, task_id, notes)
        self._append_run_history(summary, success, task_id)
        self._rewrite_daily()

    def explicit_report(self) -> str:
        """Force-write the daily report and return its current contents."""
        self._rewrite_daily()
        return (reports_dir() / "daily.md").read_text()

    # ----- bits ------------------------------------------------------------

    def _update_heartbeat(self) -> None:
        p = reports_dir() / "heartbeat.json"
        p.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "last_cycle_at": _now(),
            "supervisor_pid": None,
            "cycles_completed": self._inc_cycle_counter(),
            "last_cycle_status": self.state["status"],
            "next_cycle_eta_seconds": None,
        }
        p.write_text(json.dumps(data, indent=2) + "\n")

    def _inc_cycle_counter(self) -> int:
        p = reports_dir() / "heartbeat.json"
        try:
            data = json.loads(p.read_text())
            n = int(data.get("cycles_completed") or 0)
        except (OSError, ValueError, json.JSONDecodeError):
            n = 0
        return n + 1

    def _append_session_log(self, summary: str, success: bool,
                            task_id: Optional[str], notes: str) -> None:
        p = reports_dir() / "session-log.md"
        p.parent.mkdir(parents=True, exist_ok=True)
        tag = "ok" if success else "warn"
        line = (
            f"\n- {_now()}  cycle.{tag}  task={task_id or '-'}  "
            f"mode={self.state['cost_mode']}  summary={summary}"
        )
        if notes:
            line += f"\n  notes: {notes}"
        with p.open("a") as f:
            f.write(line)

    def _append_run_history(self, summary: str, success: bool,
                            task_id: Optional[str]) -> None:
        p = reports_dir() / "run-history.md"
        p.parent.mkdir(parents=True, exist_ok=True)
        existing = p.read_text() if p.exists() else "# Run history\n\n"
        line = (
            f"\n{_now()}  {self.state['cost_mode']}  "
            f"{'ok' if success else 'warn'}  {task_id or '-'}  {summary}"
        )
        p.write_text(existing.rstrip() + line + "\n")

    def _rewrite_daily(self) -> None:
        p = reports_dir() / "daily.md"
        p.parent.mkdir(parents=True, exist_ok=True)
        s = self.state
        body = f"""# AutoDev Daily Report

> Generated: {_now()}

## Current Status

{s['status']} — phase={s['current_phase'] or '-'} task={s['current_task_id'] or '-'}

## Active Task

- ID: {s['current_task_id'] or '-'}
- Title: {s['current_task_title'] or '-'}
- Phase: {s['current_phase'] or '-'}
- Branch: {s['branch'] or '-'}

## Last test / CI / Guardian

- Test: {s['last_test_result'] or '-'}
- CI: {s['last_ci_result'] or '-'}
- Guardian: {s['last_guardian_result'] or '-'}

## Last commit / PR

- Commit: {s['last_commit'] or '-'}
- PR: {s['last_pr'] or '-'}

## Blockers

- blocked: {s['blocked']}
- blocker_reason: {s['blocker_reason'] or '-'}
- human_needed: {s['human_needed']}

For detail see `reports/human-hold.md`.

## Cost Mode / API Usage

- Mode: {s['cost_mode']}
- API allowed: {s['api_spend_allowed']}
- API spend today: ${s['api_spend_today_usd']}

## Next Planned Action

{s['next_action'] or '(none)'}

## Health

{s['health_status']}
"""
        p.write_text(body)
