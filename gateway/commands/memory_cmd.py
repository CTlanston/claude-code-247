from __future__ import annotations

import json

import click

from memory.compiler import compile_all, compile_repo
from memory.db import init_db
from orchestrator.repo_registry import load_registry


@click.group("memory", help="Memory: .agent files, retrieval, compiler.")
def memory() -> None:
    pass


@memory.command("compile", help="Run the memory compiler.")
@click.option("--daily/--weekly", "daily", default=True,
              help="Daily (default) or weekly window.")
@click.option("--repo", "repo_id", default=None,
              help="Compile a single repo; default is all registered repos.")
@click.option("--json", "as_json", is_flag=True)
def compile_(daily: bool, repo_id: str | None, as_json: bool) -> None:
    init_db()
    window = "daily" if daily else "weekly"
    if repo_id:
        match = [r for r in load_registry() if r.id == repo_id]
        if not match:
            raise click.ClickException(f"unknown repo {repo_id!r}")
        results = [compile_repo(match[0], window=window)]
    else:
        results = compile_all(window=window)
    if as_json:
        click.echo(json.dumps([r.to_dict() for r in results], indent=2))
        return
    for r in results:
        click.echo(f"{r.repo_id} [{r.window}]: "
                   f"{r.memory_items_added} item(s) added; "
                   f"{len(r.files_updated)} file(s) updated")
        for n in r.notes:
            click.echo(f"  note: {n}")


@memory.command("init", help="Create empty .agent/*.md stubs in a repo.")
@click.option("--repo", "repo_id", required=True)
@click.option("--json", "as_json", is_flag=True)
def init_(repo_id: str, as_json: bool) -> None:
    from memory.repo_memory import AgentMemory
    from pathlib import Path
    init_db()
    match = [r for r in load_registry() if r.id == repo_id]
    if not match:
        raise click.ClickException(f"unknown repo {repo_id!r}")
    repo = match[0]
    mem = AgentMemory(repo_path=Path(repo.local_path).expanduser())
    created = mem.initialize_if_missing()
    if as_json:
        click.echo(json.dumps([str(p) for p in created]))
        return
    if not created:
        click.echo("all .agent files already present")
        return
    click.echo(f"created {len(created)} stub file(s):")
    for p in created:
        click.echo(f"  {p}")
