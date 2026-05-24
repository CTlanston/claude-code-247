"""approve-merge / reject-merge / risk CLI commands."""
from __future__ import annotations

import json

import click

from memory.db import init_db
from orchestrator.command_queue import enqueue


@click.command("approve-merge", help="Approve a pending PR merge.")
@click.option("--repo", "repo_id", required=True)
@click.option("--pr", "pr_number", required=True, type=int)
@click.option("--json", "as_json", is_flag=True)
def approve_merge(repo_id: str, pr_number: int, as_json: bool) -> None:
    init_db()
    cmd = enqueue("approve_merge", repo_id=repo_id, pr_number=pr_number)
    _emit(cmd, as_json, f"approve-merge {repo_id}#{pr_number}")


@click.command("reject-merge", help="Reject a pending PR merge.")
@click.option("--repo", "repo_id", required=True)
@click.option("--pr", "pr_number", required=True, type=int)
@click.option("--reason", default="", help="Optional rejection reason.")
@click.option("--json", "as_json", is_flag=True)
def reject_merge(repo_id: str, pr_number: int, reason: str, as_json: bool) -> None:
    init_db()
    cmd = enqueue("reject_merge", repo_id=repo_id, pr_number=pr_number,
                  payload={"reason": reason})
    _emit(cmd, as_json, f"reject-merge {repo_id}#{pr_number}")


@click.command("risk", help="Show the most recent risk assessment for a PR.")
@click.option("--repo", "repo_id", required=True)
@click.option("--pr", "pr_number", required=True, type=int)
@click.option("--json", "as_json", is_flag=True)
def risk(repo_id: str, pr_number: int, as_json: bool) -> None:
    from memory.db import open_db
    init_db()
    with open_db() as conn:
        row = conn.execute(
            """
            SELECT rs.score, rs.level, rs.factors_json, rs.created_at, t.id AS task_id
            FROM risk_scores rs
            JOIN prs p ON p.id = rs.pr_id
            LEFT JOIN tasks t ON t.id = rs.task_id
            WHERE p.repo_id = ? AND p.pr_number = ?
            ORDER BY rs.created_at DESC LIMIT 1
            """,
            (repo_id, pr_number),
        ).fetchone()
    if row is None:
        raise click.ClickException(f"no risk score recorded for {repo_id}#{pr_number}")
    factors = json.loads(row["factors_json"])
    if as_json:
        click.echo(json.dumps({
            "repo": repo_id, "pr": pr_number, "score": row["score"],
            "level": row["level"], "task_id": row["task_id"], "factors": factors,
            "computed_at": row["created_at"],
        }, indent=2))
        return
    click.echo(f"{repo_id}#{pr_number}  score={row['score']}  level={row['level']}")
    click.echo("factors:")
    for f in factors:
        click.echo(f"  {f['weight']:>4}  {f['name']:<28}  {f.get('reason', '')}")


def _emit(cmd, as_json: bool, label: str) -> None:
    if as_json:
        click.echo(json.dumps({"command_id": cmd.id, "status": cmd.status}, indent=2))
    else:
        click.echo(f"{label}: queued {cmd.id}")
