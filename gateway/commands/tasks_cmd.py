from __future__ import annotations

import json

import click

from memory.db import init_db
from orchestrator.task_manager import get_task, get_timeline, list_tasks


@click.command("tasks", help="List recent tasks.")
@click.option("--repo", "repo_id", default=None)
@click.option("--status", default=None)
@click.option("--limit", default=50, show_default=True)
@click.option("--json", "as_json", is_flag=True)
@click.option("--plain", "as_plain", is_flag=True)
def tasks(repo_id: str | None, status: str | None, limit: int, as_json: bool, as_plain: bool) -> None:
    init_db()
    rows = list_tasks(repo_id=repo_id, status=status, limit=limit)
    if as_json:
        click.echo(json.dumps([{
            "id": t.id, "repo": t.repo_id, "status": t.status, "goal": t.goal,
            "branch": t.branch, "pr": t.pr_number, "created_at": t.created_at,
        } for t in rows], indent=2))
        return
    if not rows:
        click.echo("No tasks.")
        return
    if as_plain:
        for t in rows:
            click.echo(f"{t.id[:14]} [{t.status}] {t.repo_id} :: {t.goal[:48]}")
        return
    hdr = f"{'ID':<32} {'REPO':<24} {'STATUS':<18} {'GOAL':<40}"
    click.echo(hdr)
    click.echo("-" * len(hdr))
    for t in rows:
        click.echo(
            f"{t.id[:32]:<32} {t.repo_id[:24]:<24} {t.status[:18]:<18} {t.goal[:40]:<40}"
        )


@click.command("task", help="Show one task + its timeline.")
@click.argument("task_id")
@click.option("--json", "as_json", is_flag=True)
def task_show(task_id: str, as_json: bool) -> None:
    init_db()
    t = get_task(task_id)
    if t is None:
        raise click.ClickException(f"task {task_id} not found")
    events = get_timeline(task_id)
    if as_json:
        click.echo(json.dumps({
            "id": t.id, "repo": t.repo_id, "status": t.status, "goal": t.goal,
            "branch": t.branch, "pr": t.pr_number, "risk_score": t.risk_score,
            "created_at": t.created_at, "updated_at": t.updated_at,
            "finished_at": t.finished_at,
            "events": events,
        }, indent=2, sort_keys=True))
        return
    click.echo(f"task   : {t.id}")
    click.echo(f"repo   : {t.repo_id}")
    click.echo(f"status : {t.status}")
    click.echo(f"goal   : {t.goal}")
    if t.branch:
        click.echo(f"branch : {t.branch}")
    if t.pr_number is not None:
        click.echo(f"PR     : #{t.pr_number}")
    click.echo("")
    click.echo("timeline:")
    for ev in events:
        click.echo(f"  {ev['created_at']}  {ev['event_type']:<22}  {ev['message']}")
