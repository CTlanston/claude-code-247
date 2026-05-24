from __future__ import annotations

import click

from gateway.doctor import ALL_CHECKS, check_claude_smoke, run_doctor, to_json, to_plain


@click.command("doctor", help="Check that the local environment is ready.")
@click.option("--json", "as_json", is_flag=True, help="Emit machine-readable JSON.")
@click.option("--plain", "as_plain", is_flag=True, help="Plain mobile-friendly text.")
@click.option("--with-claude-smoke", is_flag=True,
              help="Round-trip a trivial prompt through `claude -p` (slow, multi-second).")
def doctor(as_json: bool, as_plain: bool, with_claude_smoke: bool) -> None:
    checks = list(ALL_CHECKS)
    if with_claude_smoke:
        checks.append(check_claude_smoke)
    results, ok = run_doctor(checks)
    if as_json:
        click.echo(to_json(results, ok))
    else:
        click.echo(to_plain(results, ok))
    if not ok:
        raise SystemExit(2)
