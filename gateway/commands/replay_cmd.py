from __future__ import annotations

import json

import click

from memory.db import init_db
from orchestrator.replay_manager import build_replay_package, explain, replay_repair


@click.command("replay", help="Build a failure replay package for a task.")
@click.option("--task", "task_id", required=True)
@click.option("--dry-run", "dry_run", is_flag=True,
              help="Only build the package; do not re-run.")
@click.option("--explain-only", "explain_only", is_flag=True,
              help="Build the package + print a short summary; no re-run.")
@click.option("--repair", "repair", is_flag=True,
              help="Re-run the worker against the existing workspace with roles enabled.")
@click.option("--json", "as_json", is_flag=True)
def replay(task_id: str, dry_run: bool, explain_only: bool, repair: bool,
            as_json: bool) -> None:
    init_db()
    if sum(int(x) for x in (dry_run, explain_only, repair)) > 1:
        raise click.UsageError("specify at most one of --dry-run, --explain-only, --repair")
    pkg = build_replay_package(task_id)

    if as_json:
        body: dict = {"package_path": str(pkg.path), "package": pkg.to_dict()}
    else:
        body = None

    if repair:
        result = replay_repair(pkg)
        if as_json:
            assert body is not None
            body["repair"] = result
            click.echo(json.dumps(body, indent=2, default=str))
        else:
            click.echo(explain(pkg))
            click.echo("")
            click.echo(f"repair exit_code={result['exit_code']}; "
                       f"branch={result['branch']}; workspace={result['workspace']}")
        return

    if explain_only:
        if as_json:
            click.echo(json.dumps(body, indent=2, default=str))
        else:
            click.echo(explain(pkg))
        return

    # default == --dry-run behavior: emit + path
    if as_json:
        click.echo(json.dumps(body, indent=2, default=str))
    else:
        click.echo(f"replay package written to {pkg.path}")
