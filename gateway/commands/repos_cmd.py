from __future__ import annotations

import json

import click

from memory.db import init_db, open_db
from orchestrator.repo_registry import default_repos_path, load_registry, sync_to_db


@click.command("repos", help="List configured repos from the registry.")
@click.option("--json", "as_json", is_flag=True, help="Emit JSON.")
@click.option("--plain", "as_plain", is_flag=True, help="Mobile-friendly plain text.")
@click.option("--sync/--no-sync", default=True, help="Sync YAML to SQLite before listing.")
def repos(as_json: bool, as_plain: bool, sync: bool) -> None:
    entries = load_registry()
    if sync:
        init_db()
        sync_to_db(entries)
    if as_json:
        payload = [
            {
                "id": e.id,
                "name": e.name,
                "github": e.github_full_name,
                "local_path": e.local_path,
                "default_branch": e.default_branch,
                "enabled": e.enabled,
                "risk_level": e.risk_level,
            }
            for e in entries
        ]
        click.echo(json.dumps({"repos": payload, "count": len(payload)}, indent=2))
        return
    if not entries:
        path = default_repos_path()
        click.echo(f"No repos registered yet. Edit {path} or run `claude247 repo add`.")
        return
    if as_plain:
        for e in entries:
            badge = "on" if e.enabled else "off"
            click.echo(f"{e.id} [{badge}] {e.github_full_name} (risk={e.risk_level})")
        return
    # default: lightly-formatted table
    header = f"{'ID':<28} {'GITHUB':<40} {'BRANCH':<10} {'EN':<3} {'RISK':<6}"
    click.echo(header)
    click.echo("-" * len(header))
    for e in entries:
        click.echo(
            f"{e.id[:28]:<28} {e.github_full_name[:40]:<40} {e.default_branch[:10]:<10} "
            f"{('Y' if e.enabled else 'N'):<3} {e.risk_level[:6]:<6}"
        )


@click.command("repo", help="Repo subcommands.")
def repo() -> None:
    pass  # placeholder; subcommands land in M2
