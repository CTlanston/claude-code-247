from __future__ import annotations

import click

from gateway.doctor import run_doctor, to_json, to_plain


@click.command("doctor", help="Check that the local environment is ready.")
@click.option("--json", "as_json", is_flag=True, help="Emit machine-readable JSON.")
@click.option("--plain", "as_plain", is_flag=True, help="Plain mobile-friendly text.")
def doctor(as_json: bool, as_plain: bool) -> None:
    checks, ok = run_doctor()
    if as_json:
        click.echo(to_json(checks, ok))
    else:
        click.echo(to_plain(checks, ok))
    if not ok:
        raise SystemExit(2)
