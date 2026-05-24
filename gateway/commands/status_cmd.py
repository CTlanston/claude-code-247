from __future__ import annotations

import json
import time

import click

from memory.db import default_db_path, init_db, open_db, schema_version
from orchestrator import system_state
from orchestrator.config import load_config
from orchestrator.repo_registry import load_registry


_ACTIVE_TASK_STATUSES = (
    "queued", "planning", "coding", "testing", "reviewing",
    "validating", "pr_created", "auto_merging",
)


def _build_status() -> dict[str, object]:
    cfg = load_config()
    init_db()
    entries = load_registry()
    today_iso = time.strftime("%Y-%m-%d", time.gmtime())
    with open_db() as conn:
        sv = schema_version(conn)
        task_counts: dict[str, int] = {}
        for row in conn.execute("SELECT status, COUNT(*) AS c FROM tasks GROUP BY status"):
            task_counts[row["status"]] = int(row["c"])
        active = sum(task_counts.get(s, 0) for s in _ACTIVE_TASK_STATUSES)
        stuck = task_counts.get("stuck", 0)
        waiting_approval_tasks = task_counts.get("waiting_for_approval", 0)
        pending_cmds = int(conn.execute(
            "SELECT COUNT(*) AS c FROM commands WHERE status IN ('queued','running','requires_approval')"
        ).fetchone()["c"])
        approvals = int(conn.execute(
            "SELECT COUNT(*) AS c FROM commands WHERE status = 'requires_approval'"
        ).fetchone()["c"])
        today_completed = int(conn.execute(
            "SELECT COUNT(*) AS c FROM tasks WHERE status='merged' AND finished_at LIKE ?",
            (f"{today_iso}%",),
        ).fetchone()["c"])
        today_failed = int(conn.execute(
            "SELECT COUNT(*) AS c FROM tasks WHERE status IN ('failed','cancelled') "
            "AND finished_at LIKE ?",
            (f"{today_iso}%",),
        ).fetchone()["c"])
        stuck_row = conn.execute(
            "SELECT id FROM tasks WHERE status='stuck' ORDER BY updated_at DESC LIMIT 1"
        ).fetchone()
        approval_row = conn.execute(
            "SELECT repo_id, pr_number FROM prs WHERE approval_state='required' "
            "ORDER BY updated_at DESC LIMIT 1"
        ).fetchone()
    next_actions: list[str] = []
    if stuck_row:
        next_actions.append(f"claude247 explain-stuck --task {stuck_row['id']}")
    if approval_row and approval_row["pr_number"] is not None:
        next_actions.append(
            f"claude247 approve-merge --repo {approval_row['repo_id']} "
            f"--pr {approval_row['pr_number']}"
        )
    flags = system_state.snapshot()
    paused_repos = sorted(
        k.removeprefix("repo.paused.")
        for k, v in flags.items()
        if k.startswith("repo.paused.") and v == "1"
    )
    return {
        "system": {
            "auth_mode": cfg.auth_mode,
            "allow_remote_writes": cfg.allow_remote_writes,
            "dashboard": f"{cfg.dashboard_host}:{cfg.dashboard_port}",
            "db_path": str(default_db_path()),
            "schema_version": sv,
            "paused": system_state.is_system_paused(),
            "paused_repos": paused_repos,
        },
        "repos": {
            "count": len(entries),
            "enabled": sum(1 for e in entries if e.enabled),
        },
        "tasks": task_counts,
        "active": active,
        "stuck": stuck,
        "waiting_approval_tasks": waiting_approval_tasks,
        "today_completed": today_completed,
        "today_failed": today_failed,
        "commands": {"pending": pending_cmds, "requires_approval": approvals},
        "next_actions": next_actions,
    }


@click.command("status", help="Show system-wide status.")
@click.option("--json", "as_json", is_flag=True)
@click.option("--plain", "as_plain", is_flag=True, help="Mobile-friendly text.")
def status(as_json: bool, as_plain: bool) -> None:
    s = _build_status()
    if as_json:
        click.echo(json.dumps(s, indent=2, sort_keys=True))
        return
    if as_plain:
        # Mirrors the directive §8 example shape — terse, phone-sized.
        sys_s = s["system"]
        repos_s = s["repos"]
        click.echo(f"System: {'paused' if sys_s['paused'] else 'running'}")
        click.echo(f"Repos enabled: {repos_s['enabled']}")
        click.echo(f"Active tasks: {s['active']}")
        click.echo(f"Stuck tasks: {s['stuck']}")
        click.echo(
            f"Need approval: {s['waiting_approval_tasks'] + s['commands']['requires_approval']}"
        )
        click.echo(f"Today: {s['today_completed']} completed, {s['today_failed']} failed")
        if sys_s["paused_repos"]:
            click.echo("Paused repos: " + ", ".join(sys_s["paused_repos"]))
        if s["next_actions"]:
            click.echo("Next actions:")
            for action in s["next_actions"]:
                click.echo(f"- {action}")
        return
    # default formatted output
    sys_s = s["system"]
    repos_s = s["repos"]
    click.echo("─ claude-code-247 status ─────────────────────────────")
    click.echo(f"  auth mode         : {sys_s['auth_mode']}")
    click.echo(f"  allow_remote_writes: {sys_s['allow_remote_writes']}")
    click.echo(f"  system paused     : {sys_s['paused']}")
    click.echo(f"  dashboard         : http://{sys_s['dashboard']}")
    click.echo(f"  db                : {sys_s['db_path']} (schema v{sys_s['schema_version']})")
    click.echo(f"  repos             : {repos_s['enabled']} enabled / {repos_s['count']} total")
    if sys_s["paused_repos"]:
        click.echo(f"  paused repos      : {', '.join(sys_s['paused_repos'])}")
    tasks_part = ", ".join(f"{k}={v}" for k, v in sorted(s["tasks"].items())) or "(none)"
    click.echo(f"  tasks by status   : {tasks_part}")
    click.echo(f"  active            : {s['active']}  stuck: {s['stuck']}  "
               f"waiting-approval: {s['waiting_approval_tasks']}")
    click.echo(f"  today             : {s['today_completed']} completed, "
               f"{s['today_failed']} failed")
    cmds = s["commands"]
    click.echo(f"  pending commands  : {cmds['pending']} (approvals: {cmds['requires_approval']})")
    if s["next_actions"]:
        click.echo(f"  next              : {s['next_actions'][0]}")
