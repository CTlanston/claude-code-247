"""Prometheus text-format metrics.

Exposed at ``GET /metrics`` on the dashboard. Pulled from the SQLite
state in one pass so this stays cheap. No client library — we emit the
text protocol by hand:

  # HELP <name> <description>
  # TYPE <name> <type>
  <name>{label="value",…} <value>
"""
from __future__ import annotations

from pathlib import Path

from memory.db import open_db
from orchestrator import system_state
from orchestrator.config import load_config


def render(db_path: Path | str | None = None) -> str:
    cfg = load_config()
    lines: list[str] = []

    with open_db(db_path) as conn:
        # tasks by status
        rows = list(conn.execute(
            "SELECT status, COUNT(*) AS c FROM tasks GROUP BY status"
        ))
        lines.append("# HELP claude247_tasks_total Count of tasks by status")
        lines.append("# TYPE claude247_tasks_total gauge")
        for r in rows:
            lines.append(
                f'claude247_tasks_total{{status="{r["status"]}"}} {int(r["c"])}'
            )

        # commands by status
        rows = list(conn.execute(
            "SELECT status, COUNT(*) AS c FROM commands GROUP BY status"
        ))
        lines.append("# HELP claude247_commands_total Count of commands by status")
        lines.append("# TYPE claude247_commands_total gauge")
        for r in rows:
            lines.append(
                f'claude247_commands_total{{status="{r["status"]}"}} {int(r["c"])}'
            )

        # PRs by state
        rows = list(conn.execute(
            "SELECT state, COUNT(*) AS c FROM prs GROUP BY state"
        ))
        lines.append("# HELP claude247_prs_total Count of PRs by state")
        lines.append("# TYPE claude247_prs_total gauge")
        for r in rows:
            lines.append(
                f'claude247_prs_total{{state="{r["state"]}"}} {int(r["c"])}'
            )

        # open alerts
        n = int(conn.execute(
            "SELECT COUNT(*) AS c FROM alerts WHERE acknowledged = 0"
        ).fetchone()["c"])
        lines.append("# HELP claude247_open_alerts Open alert count")
        lines.append("# TYPE claude247_open_alerts gauge")
        lines.append(f"claude247_open_alerts {n}")

        # log row count
        n = int(conn.execute("SELECT COUNT(*) AS c FROM logs").fetchone()["c"])
        lines.append("# HELP claude247_log_rows Total log rows")
        lines.append("# TYPE claude247_log_rows gauge")
        lines.append(f"claude247_log_rows {n}")

        # memory item count
        n = int(conn.execute(
            "SELECT COUNT(*) AS c FROM memory_items"
        ).fetchone()["c"])
        lines.append("# HELP claude247_memory_items Total memory items")
        lines.append("# TYPE claude247_memory_items gauge")
        lines.append(f"claude247_memory_items {n}")

    # system flags
    lines.append("# HELP claude247_system_paused 1 when stop-all is active")
    lines.append("# TYPE claude247_system_paused gauge")
    lines.append(f"claude247_system_paused {1 if system_state.is_system_paused() else 0}")

    lines.append("# HELP claude247_allow_remote_writes 1 when push/merge is enabled")
    lines.append("# TYPE claude247_allow_remote_writes gauge")
    lines.append(f"claude247_allow_remote_writes {1 if cfg.allow_remote_writes else 0}")

    return "\n".join(lines) + "\n"
