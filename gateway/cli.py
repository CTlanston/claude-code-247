"""`claude247` CLI entry point.

Subcommands are defined in ``gateway.commands.*``; this module wires them
into a Click group and provides the entry point referenced from
``pyproject.toml`` as ``project.scripts.claude247``.
"""
from __future__ import annotations

import sys

import click

from gateway.commands.control_cmd import (
    explain_stuck as explain_stuck_cmd,
    pause as pause_cmd,
    resume as resume_cmd,
    stop as stop_cmd,
    stop_all as stop_all_cmd,
)
from gateway.commands.doctor_cmd import doctor as doctor_cmd
from gateway.commands.logs_cmd import logs as logs_grp
from gateway.commands.memory_cmd import memory as memory_grp
from gateway.commands.merge_cmd import (
    approve_merge as approve_merge_cmd,
    reject_merge as reject_merge_cmd,
    risk as risk_cmd,
)
from gateway.commands.repo_cmd import repo as repo_grp
from gateway.commands.repos_cmd import repos as repos_cmd
from gateway.commands.start_cmd import start as start_cmd
from gateway.commands.status_cmd import status as status_cmd
from gateway.commands.tasks_cmd import task_show, tasks as tasks_cmd


@click.group(help="Local-first, multi-repo, 24/7 autonomous coding coworker.")
@click.version_option(package_name="claude-code-247", message="%(version)s")
def cli() -> None:
    pass


cli.add_command(doctor_cmd)
cli.add_command(repos_cmd)
cli.add_command(repo_grp)
cli.add_command(status_cmd)
cli.add_command(start_cmd)
cli.add_command(pause_cmd)
cli.add_command(resume_cmd)
cli.add_command(stop_cmd)
cli.add_command(stop_all_cmd)
cli.add_command(explain_stuck_cmd)
cli.add_command(tasks_cmd)
cli.add_command(task_show)
cli.add_command(approve_merge_cmd)
cli.add_command(reject_merge_cmd)
cli.add_command(risk_cmd)
cli.add_command(logs_grp)
cli.add_command(memory_grp)


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
