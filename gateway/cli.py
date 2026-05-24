"""`claude247` CLI entry point.

Subcommands are defined in ``gateway.commands.*``; this module wires them
into a Click group and provides the entry point referenced from
``pyproject.toml`` as ``project.scripts.claude247``.
"""
from __future__ import annotations

import sys

import click

from gateway.commands.doctor_cmd import doctor as doctor_cmd
from gateway.commands.repos_cmd import repos as repos_cmd
from gateway.commands.status_cmd import status as status_cmd


@click.group(help="Local-first, multi-repo, 24/7 autonomous coding coworker.")
@click.version_option(package_name="claude-code-247", message="%(version)s")
def cli() -> None:
    pass


cli.add_command(doctor_cmd)
cli.add_command(repos_cmd)
cli.add_command(status_cmd)


def main() -> int:
    try:
        return cli(standalone_mode=False) or 0
    except click.exceptions.Abort:
        click.echo("aborted", err=True)
        return 1
    except click.exceptions.ClickException as e:
        e.show()
        return e.exit_code


if __name__ == "__main__":
    sys.exit(main())
