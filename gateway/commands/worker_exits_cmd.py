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
            symbol = "✓" if r.classification == "success" else "✗"
            click.echo(
                f"{symbol} {r.created_at} {r.phase:<14} "
                f"{r.classification:<22} exit={r.exit_code} "
                f"{(r.command or '')[:60]}"
            )
        return

    # default: human table
    click.echo(f"worker_exits for task {task_id}")
    click.echo("-" * 78)
    for r in rows:
        click.echo(
            f"[{r.created_at}] role={r.worker_role} phase={r.phase} "
            f"-> {r.classification} (exit={r.exit_code}, "
            f"duration={r.duration_ms}ms)"
        )
        if r.command:
            click.echo(f"  $ {r.command}")
        if r.stderr_tail:
            click.echo(f"  stderr: {r.stderr_tail[:200]}")
        if r.next_action:
            click.echo(f"  next:  {r.next_action}")
        click.echo("")
