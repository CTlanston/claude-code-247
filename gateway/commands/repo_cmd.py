"""`claude247 repo add` — interactive wizard.

We deliberately keep the wizard simple in v1: prompt for each field, run
``validate_spec()`` + ``probe_local_path()``, abort on errors, write to
repos.yaml on success. The same code is used by the dashboard's
``/onboarding`` route via ``onboard()``.
"""
from __future__ import annotations

import json

import click

from orchestrator.onboarding import onboard, validate_spec
from orchestrator.repo_registry import load_registry


@click.group("repo", help="Repo management.")
def repo() -> None:
    pass


@repo.command("add", help="Interactive wizard to register a new repo.")
@click.option("--id", "repo_id", default=None, help="Override the prompted id.")
@click.option("--from-spec", "from_spec", type=click.Path(exists=True), default=None,
              help="Read a JSON spec from this file instead of prompting.")
@click.option("--no-probe", is_flag=True, help="Skip git remote / branch probes.")
@click.option("--json", "as_json", is_flag=True)
def add(repo_id: str | None, from_spec: str | None, no_probe: bool, as_json: bool) -> None:
    if from_spec:
        with open(from_spec, encoding="utf-8") as fh:
            spec = json.load(fh)
    else:
        spec = _prompt_spec(repo_id)

    existing = {e.id for e in load_registry()}
    pre = validate_spec(spec, existing_ids=existing)
    if not pre.ok:
        for e in pre.errors:
            click.echo(f"× {e}", err=True)
        raise SystemExit(2)

    res = onboard(spec, probe_local=not no_probe)
    if as_json:
        click.echo(json.dumps({
            "ok": res.ok,
            "errors": res.errors,
            "warnings": res.warnings,
            "id": res.entry.id if res.entry else None,
        }, indent=2))
    else:
        for w in res.warnings:
            click.echo(f"! {w}")
        if res.ok and res.entry:
            click.echo(f"✓ registered {res.entry.id} ({res.entry.github_full_name})")
        else:
            for e in res.errors:
                click.echo(f"× {e}", err=True)
    if not res.ok:
        raise SystemExit(2)


@repo.command("list", help="List registered repos. Alias of `claude247 repos`.")
@click.pass_context
def list_(ctx: click.Context) -> None:
    from gateway.commands.repos_cmd import repos as repos_cmd
    ctx.invoke(repos_cmd)


def _prompt_spec(rid: str | None) -> dict[str, object]:
    rid = rid or click.prompt("repo id (short slug)", type=str)
    owner = click.prompt("github owner", type=str)
    name = click.prompt("github repo", type=str)
    local = click.prompt("local clone path", type=str)
    branch = click.prompt("default branch", type=str, default="main")
    test_cmd = click.prompt("test command (blank to skip)", type=str, default="")
    lint_cmd = click.prompt("lint command (blank to skip)", type=str, default="")
    forbidden_default = ".env, .env.*, .github/**, secrets/**, CLAUDE.md, AGENTS.md"
    forbidden = click.prompt(
        "forbidden_paths (comma-separated)", type=str, default=forbidden_default
    )
    forbidden_list = [p.strip() for p in forbidden.split(",") if p.strip()]
    auto_merge = click.confirm("allow low-risk auto-merge for this repo?", default=False)

    spec: dict[str, object] = {
        "id": rid,
        "github_owner": owner,
        "github_repo": name,
        "local_path": local,
        "default_branch": branch,
        "enabled": True,
        "risk_level": "low",
        "forbidden_paths": forbidden_list,
        "auto_merge": {"enabled": bool(auto_merge), "max_risk_score": 30, "max_changed_lines": 300},
    }
    if test_cmd:
        spec["test_commands"] = [test_cmd]
    if lint_cmd:
        spec["lint_commands"] = [lint_cmd]
    return spec
