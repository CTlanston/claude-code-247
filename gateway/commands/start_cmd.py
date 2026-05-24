from __future__ import annotations

import json

import click

from memory.db import init_db
from orchestrator.command_queue import enqueue
from orchestrator.repo_registry import load_registry, sync_to_db


@click.command("start", help="Enqueue a new task for a repo.")
@click.option("--repo", "repo_id", required=True, help="Repo id from the registry.")
@click.option("--goal", required=True, help="Plain-English task goal.")
@click.option("--source", default="cli", show_default=True,
              help="Where this task originated (cli|dashboard|remote|issue).")
@click.option("--source-ref", default=None, help="Optional reference (issue #, etc.).")
@click.option("--json", "as_json", is_flag=True)
def start(repo_id: str, goal: str, source: str, source_ref: str | None, as_json: bool) -> None:
    init_db()
    sync_to_db(load_registry())
    cmd = enqueue(
        "start_task",
        repo_id=repo_id,
        source=source,
        payload={"repo_id": repo_id, "goal": goal, "source_ref": source_ref},
    )
    if as_json:
        click.echo(json.dumps({
            "command_id": cmd.id, "status": cmd.status, "queued_at": cmd.created_at,
        }, indent=2))
    else:
        click.echo(f"queued command {cmd.id} for repo {repo_id!r}: {goal[:60]}{'...' if len(goal) > 60 else ''}")
