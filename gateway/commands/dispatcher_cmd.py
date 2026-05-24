from __future__ import annotations

import json
import sys

import click

from memory.db import init_db
from orchestrator import env_loader
from orchestrator.dispatcher import run_loop, run_once


@click.command("dispatcher", help="Drain the command queue.")
@click.option("--once/--loop", default=True, show_default=True,
              help="--once processes at most one command and exits "
                   "(launchd polling mode). --loop runs forever.")
@click.option("--interval", "interval_s", default=None, type=float,
              help="Loop poll interval in seconds. Defaults to config "
                   "system.poll_interval_seconds.")
@click.option("--max-iterations", "max_iter", default=None, type=int,
              help="--loop: stop after N iterations (used by tests).")
@click.option("--json", "as_json", is_flag=True)
def dispatcher(once: bool, interval_s: float | None,
                max_iter: int | None, as_json: bool) -> None:
    # Pick up GEMINI_API_KEY / OPENAI_API_KEY / NTFY_TOPIC from
    # ~/.claude-code-247/.env before any validator / notification call.
    # launchd's EnvironmentVariables doesn't reach validator subprocesses.
    env_loader.load()
    init_db()
    if once:
        res = run_once()
        if as_json:
            click.echo(json.dumps(res.to_dict(), indent=2, default=str))
        else:
            if res.handled:
                click.echo(f"handled {res.command_type} ({res.command_id}) "
                           f"→ {res.status}")
            else:
                click.echo(f"idle: {res.reason}")
        sys.exit(0 if res.handled or res.reason in ("queue empty", "system paused") else 1)

    results = run_loop(
        interval_seconds=interval_s,
        max_iterations=max_iter,
    )
    if as_json:
        click.echo(json.dumps([r.to_dict() for r in results], indent=2, default=str))
