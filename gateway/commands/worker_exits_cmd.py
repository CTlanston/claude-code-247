"""`claude247 worker-exits` — surface worker_exits rows for a task.

M19/BR-003. Pairs with ``explain-stuck`` (which embeds the rows in the
JSON summary) but is friendlier to grep / paste into a paging tool.
"""
from __future__ import annotations

import json

import click

from memory.db import init_db
from orchestrator.worker_exits import list_worker_exits


@click.command(
    "worker-exits",
    help="Show the per-phase worker_exits records for a task.",
)
@click.option("--task", "task_id", required=True, help="Task id to inspect.")
@click.option("--json", "as_json", is_flag=True, help="Emit JSON for piping.")
@click.option("--plain", "as_plain", is_flag=True,
              help="Mobile-friendly one-line-per-row output.")
@click.option("--limit", type=int, default=None,
              help="Cap the number of rows returned (oldest-first).")
def worker_exits(
    task_id: str, as_json: bool, as_plain: bool, limit: int | None,
) -> None:
    init_db()
    rows = list_worker_exits(task_id=task_id, limit=limit)

    if as_json:
        click.echo(json.dumps([r.to_dict() for r in rows], indent=2))
        return

    if not rows:
        if as_plain:
            click.echo(f"task {task_id}: no worker_exits recorded yet")
        else:
            click.echo(f"No worker_exits found for task {task_id!r}.")
        return

    if as_plain:
        for r in rows:
            # M21-P2: prefer the lifecycle ``status`` over the older
            # ``classification`` for the at-a-glance symbol.
            effective = r.status or r.classification
            symbol = {
                "success": "✓", "skipped": "•", "in_progress": "…",
            }.get(effective, "✗")
            dur = f"{r.duration_ms}ms" if r.duration_ms is not None else "?"
            err = f" {r.error_type}" if r.error_type else ""
            click.echo(
                f"{symbol} {r.started_at or r.created_at} {r.phase:<18} "
                f"{(r.status or r.classification):<14}{err} dur={dur}"
            )
        return

    # default: human table
    click.echo(f"worker_exits for task {task_id}")
    click.echo("-" * 78)
    for r in rows:
        status_label = r.status or r.classification
        click.echo(
            f"[{r.started_at or r.created_at}] role={r.worker_role} phase={r.phase} "
            f"-> {status_label} ({r.classification}, exit={r.exit_code}, "
            f"duration={r.duration_ms}ms)"
        )
        if r.error_type:
            click.echo(f"  error: {r.error_type}: {r.error_message or ''}")
        if r.command:
            click.echo(f"  $ {r.command}")
        if r.stderr_tail:
            click.echo(f"  stderr: {r.stderr_tail[:200]}")
        if r.next_action:
            click.echo(f"  next:  {r.next_action}")
        if r.payload:
            click.echo(f"  meta:  {r.payload}")
        click.echo("")


# M21-P2: `claude247 task-phases --task <id>` is the directive's
# preferred spelling. We register the same callback under both names
# in gateway/cli.py so it doesn't matter which the operator types.
