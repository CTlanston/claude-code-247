"""`claude247 status-board` — read-only watchdog dashboard.

Aggregates release state + 24h soak progress + launchd/dispatcher/
dashboard/notifier health + queue stats + recent signals + GA gate
state into a single snapshot, then renders it as plain text, JSON, or
a Markdown report. Never writes to the runtime DB or mutates any
launchd service.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import click

from gateway.status_board import (
    collect_status_board,
    render_markdown,
    render_plain,
    write_markdown,
)
from memory.db import init_db


def _parse_t0(raw: str | None) -> datetime | None:
    if not raw:
        return None
    s = raw.strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
    except ValueError as exc:
        raise click.BadParameter(
            f"--t0 must be ISO-8601 UTC like 2026-05-24T21:46Z; got {raw!r}"
        ) from exc
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


@click.command(
    "status-board",
    help="Read-only watchdog dashboard (release, soak, runtime, queue, GA).",
)
@click.option("--plain", "as_plain", is_flag=True,
              help="Mobile-friendly plain text output.")
@click.option("--json", "as_json", is_flag=True,
              help="Machine-readable JSON output.")
@click.option("--write-md", "write_md", type=click.Path(),
              default=None,
              help="Also write a Markdown dashboard to PATH.")
@click.option("--t0", "t0_override", default=None,
              help="Override soak T0 (ISO-8601 UTC, e.g. 2026-05-24T21:46Z).")
def status_board(as_plain: bool, as_json: bool, write_md: str | None,
                  t0_override: str | None) -> None:
    """Read-only watchdog. Safe to run while a soak is in progress."""
    # ``init_db`` is idempotent; it never modifies a pre-existing DB
    # other than backwards-compatible ALTERs. We need it because the
    # status board reads via the same connection helpers as everywhere
    # else and SQLite still needs the file present.
    init_db()
    board = collect_status_board(t0_override=_parse_t0(t0_override))
    if write_md:
        path = write_markdown(board, Path(write_md))
        click.echo(f"wrote {path}", err=True)
    if as_json:
        click.echo(json.dumps(board.to_dict(), indent=2, sort_keys=True))
        return
    # ``--plain`` and default both render the plain dashboard; JSON-only
    # callers pass ``--json``. ``--write-md`` alone (no other flags)
    # still emits the plain view so an interactive call shows something.
    click.echo(render_plain(board), nl=False)
