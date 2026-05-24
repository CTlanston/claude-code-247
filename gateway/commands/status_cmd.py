from __future__ import annotations

import json

import click

from memory.db import default_db_path, init_db, open_db, schema_version
from orchestrator import system_state
from orchestrator.config import load_config
from orchestrator.repo_registry import load_registry


def _build_status() -> dict[str, object]:
    cfg = load_config()
    init_db()
    entries = load_registry()
    with open_db() as conn:
        sv = schema_version(conn)
        task_counts: dict[str, int] = {}
        for row in conn.execute("SELECT status, COUNT(*) AS c FROM tasks GROUP BY status"):
            task_counts[row["status"]] = int(row["c"])
        pending_cmds = int(
            conn.execute(
                "SELECT COUNT(*) AS c FROM commands WHERE status IN ('queued','running','requires_approval')"
            ).fetchone()["c"]
        )
        approvals = int(
            conn.execute(
                "SELECT COUNT(*) AS c FROM commands WHERE status = 'requires_approval'"
            ).fetchone()["c"]
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
        "commands": {"pending": pending_cmds, "requires_approval": approvals},
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
        sys_s = s["system"]
        repos_s = s["repos"]
        paused_part = " PAUSED" if sys_s["paused"] else ""
        click.echo(
            f"System: {sys_s['auth_mode']} | writes={'on' if sys_s['allow_remote_writes'] else 'off'}{paused_part}"
        )
        click.echo(f"Repos: {repos_s['enabled']}/{repos_s['count']} enabled")
        if sys_s["paused_repos"]:
            click.echo("Paused repos: " + ", ".join(sys_s["paused_repos"]))
        if s["tasks"]:
            parts = [f"{k}={v}" for k, v in sorted(s["tasks"].items())]
            click.echo("Tasks: " + " ".join(parts))
        else:
            click.echo("Tasks: 0")
        cmds = s["commands"]
        click.echo(f"Pending commands: {cmds['pending']} (approvals: {cmds['requires_approval']})")
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
    cmds = s["commands"]
    click.echo(f"  pending commands  : {cmds['pending']} (approvals: {cmds['requires_approval']})")
