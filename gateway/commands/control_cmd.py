"""pause / resume / stop / explain-stuck / stop-all commands."""
from __future__ import annotations

import json

import click

from memory.db import init_db
from orchestrator.command_queue import enqueue


def _emit(cmd, as_json: bool, verb: str) -> None:
    if as_json:
        click.echo(json.dumps({"command_id": cmd.id, "status": cmd.status}, indent=2))
    else:
        click.echo(f"{verb}: queued command {cmd.id}")


@click.command("pause", help="Pause a repo, task, or the whole system.")
@click.option("--system", is_flag=True, help="Pause the entire scheduler.")
@click.option("--repo", "repo_id", default=None, help="Pause a single repo.")
@click.option("--task", "task_id", default=None, help="Pause a single task.")
@click.option("--json", "as_json", is_flag=True)
def pause(system: bool, repo_id: str | None, task_id: str | None, as_json: bool) -> None:
    init_db()
    if sum(bool(x) for x in (system, repo_id, task_id)) != 1:
        raise click.UsageError("specify exactly one of --system, --repo, --task")
    if system:
        cmd = enqueue("set_mode", payload={"mode": "paused"})
        _emit(cmd, as_json, "pause system")
    elif repo_id:
        cmd = enqueue("pause_repo", repo_id=repo_id)
        _emit(cmd, as_json, "pause repo")
    else:
        cmd = enqueue("pause_task", task_id=task_id)
        _emit(cmd, as_json, "pause task")


@click.command("resume", help="Resume a paused repo, task, or system.")
@click.option("--system", is_flag=True)
@click.option("--repo", "repo_id", default=None)
@click.option("--task", "task_id", default=None)
@click.option("--json", "as_json", is_flag=True)
def resume(system: bool, repo_id: str | None, task_id: str | None, as_json: bool) -> None:
    init_db()
    if sum(bool(x) for x in (system, repo_id, task_id)) != 1:
        raise click.UsageError("specify exactly one of --system, --repo, --task")
    if system:
        cmd = enqueue("set_mode", payload={"mode": "running"})
        _emit(cmd, as_json, "resume system")
    elif repo_id:
        cmd = enqueue("resume_repo", repo_id=repo_id)
        _emit(cmd, as_json, "resume repo")
    else:
        cmd = enqueue("resume_task", task_id=task_id)
        _emit(cmd, as_json, "resume task")


@click.command("stop", help="Stop a single task.")
@click.option("--task", "task_id", required=True)
@click.option("--json", "as_json", is_flag=True)
def stop(task_id: str, as_json: bool) -> None:
    init_db()
    cmd = enqueue("stop_task", task_id=task_id)
    _emit(cmd, as_json, "stop task")


@click.command("stop-all", help="Emergency: stop all active tasks.")
@click.option("--json", "as_json", is_flag=True)
def stop_all(as_json: bool) -> None:
    init_db()
    cmd = enqueue("stop_all", source="cli")
    _emit(cmd, as_json, "stop-all")


@click.command("explain-stuck", help="Ask the orchestrator to summarize why a task is stuck.")
@click.option("--task", "task_id", required=True)
@click.option("--verbose", is_flag=True)
@click.option("--json", "as_json", is_flag=True)
def explain_stuck(task_id: str, verbose: bool, as_json: bool) -> None:
    init_db()
    cmd = enqueue(
        "explain_stuck",
        task_id=task_id,
        payload={"verbose": verbose},
    )
    _emit(cmd, as_json, "explain-stuck")
