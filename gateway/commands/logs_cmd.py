from __future__ import annotations

import json

import click

from memory.db import init_db
from orchestrator import log_indexer


@click.group("logs", help="Log search and tailing.")
def logs() -> None:
    pass


@logs.command("search", help="Full-text search across structured logs.")
@click.argument("query", required=False, default="")
@click.option("--level", default=None)
@click.option("--component", default=None)
@click.option("--repo", "repo_id", default=None)
@click.option("--task", "task_id", default=None)
@click.option("--limit", default=50, show_default=True)
@click.option("--json", "as_json", is_flag=True)
def search(query: str, level: str | None, component: str | None,
           repo_id: str | None, task_id: str | None, limit: int, as_json: bool) -> None:
    init_db()
    entries = log_indexer.search(
        text=query or None, level=level, component=component,
        repo_id=repo_id, task_id=task_id, limit=limit,
    )
    _emit(entries, as_json)


@logs.command("tail", help="Show the most recent log entries.")
@click.option("--repo", "repo_id", default=None)
@click.option("--task", "task_id", default=None)
@click.option("--limit", default=20, show_default=True)
@click.option("--json", "as_json", is_flag=True)
def tail(repo_id: str | None, task_id: str | None, limit: int, as_json: bool) -> None:
    init_db()
    entries = log_indexer.tail(repo_id=repo_id, task_id=task_id, limit=limit)
    _emit(entries, as_json)


def _emit(entries, as_json: bool) -> None:
    if as_json:
        click.echo(json.dumps([
            {"id": e.id, "ts": e.created_at, "level": e.level,
             "component": e.component, "repo": e.repo_id, "task": e.task_id,
             "message": e.message}
            for e in entries
        ], indent=2))
        return
    if not entries:
        click.echo("(no logs)")
        return
    for e in reversed(entries):
        scope = " ".join(f"{k}={v}" for k, v in
                         (("repo", e.repo_id), ("task", e.task_id)) if v)
        scope_part = f" [{scope}]" if scope else ""
        click.echo(f"{e.created_at}  {e.level:<5}  {e.component:<14}{scope_part}  {e.message}")
