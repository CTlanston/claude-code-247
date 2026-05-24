"""`claude247 repo add / enable / disable / list` commands.

`add` is an interactive wizard; we keep it simple in v1: prompt for each
field, run ``validate_spec()`` + ``probe_local_path()``, abort on errors,
write to repos.yaml on success. The same code is used by the dashboard's
``/onboarding`` route via ``onboard()``.

`enable` / `disable` flip the `enabled` flag in both ``repos.yaml`` (the
canonical store) AND the SQLite mirror in one operation, so the
dispatcher's next pass sees the change without a separate sync.
"""
from __future__ import annotations

import json
from pathlib import Path

import click
import yaml

from memory.db import init_db
from orchestrator.onboarding import onboard, validate_spec
from orchestrator.repo_registry import (
    RepoRegistryError,
    default_repos_path,
    load_registry,
    parse_registry,
    sync_to_db,
)


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


@repo.command("enable", help="Set the registry entry for <repo_id> to enabled=true.")
@click.option("--repo", "repo_id", required=True)
@click.option("--json", "as_json", is_flag=True)
def enable(repo_id: str, as_json: bool) -> None:
    res = _set_enabled(repo_id, True)
    _emit_toggle(res, as_json, repo_id, "enabled")


@repo.command("disable", help="Set the registry entry for <repo_id> to enabled=false. "
                              "A disabled repo is skipped by start_task.")
@click.option("--repo", "repo_id", required=True)
@click.option("--json", "as_json", is_flag=True)
def disable(repo_id: str, as_json: bool) -> None:
    res = _set_enabled(repo_id, False)
    _emit_toggle(res, as_json, repo_id, "disabled")


def _set_enabled(repo_id: str, enabled: bool) -> dict:
    """Flip the `enabled` flag in repos.yaml + SQLite mirror.

    Returns a small result dict for the CLI to render."""
    yaml_path = default_repos_path()
    if not yaml_path.exists():
        raise click.ClickException(f"registry not found: {yaml_path}")
    body = yaml.safe_load(yaml_path.read_text(encoding="utf-8")) or {}
    repos = body.get("repos") or []
    target = next((r for r in repos if r.get("id") == repo_id), None)
    if target is None:
        raise click.ClickException(f"unknown repo_id {repo_id!r}")
    prior = bool(target.get("enabled", True))
    target["enabled"] = enabled
    body["repos"] = repos
    yaml_path.write_text(yaml.safe_dump(body, sort_keys=False), encoding="utf-8")
    init_db()
    entries = parse_registry(yaml_path.read_text(encoding="utf-8"))
    sync_to_db(entries)
    return {"repo_id": repo_id, "prior": prior, "now": enabled}


def _emit_toggle(res: dict, as_json: bool, repo_id: str, verb: str) -> None:
    if as_json:
        click.echo(json.dumps(res, indent=2))
        return
    if res["prior"] == res["now"]:
        click.echo(f"{repo_id} already {verb}; no change")
    else:
        click.echo(f"{repo_id}: {verb}")


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
