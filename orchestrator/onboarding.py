"""Repo onboarding — validation + write to repos.yaml.

Both the CLI wizard and the dashboard wizard funnel through ``onboard()``.
Validation is split into a pure ``validate_spec()`` (no side effects, easy
to unit-test) and a small ``append_to_registry()`` that writes the YAML and
syncs to SQLite.
"""
from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from orchestrator.repo_registry import (
    RepoEntry,
    default_repos_path,
    load_registry,
    parse_registry,
    sync_to_db,
)


@dataclass
class OnboardingResult:
    ok: bool
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    entry: RepoEntry | None = None


def validate_spec(spec: dict[str, Any], *, existing_ids: set[str] | None = None) -> OnboardingResult:
    """Validate a single repo spec dict. No filesystem / git probes."""
    errors: list[str] = []
    warnings: list[str] = []
    existing_ids = existing_ids or set()

    required = ("id", "github_owner", "github_repo", "local_path")
    for f in required:
        if not spec.get(f):
            errors.append(f"missing required field: {f}")

    rid = str(spec.get("id") or "")
    if rid and rid in existing_ids:
        errors.append(f"id {rid!r} already exists in registry")

    forbidden = spec.get("forbidden_paths") or []
    if not isinstance(forbidden, list) or not forbidden:
        errors.append("forbidden_paths must be a non-empty list")

    # warnings for known sensitive omissions
    if forbidden and ".env" not in forbidden:
        warnings.append("forbidden_paths does not include .env (recommended)")

    if errors:
        return OnboardingResult(ok=False, errors=errors, warnings=warnings)
    return OnboardingResult(ok=True, warnings=warnings)


def probe_local_path(
    local_path: str,
    expected_owner: str,
    expected_repo: str,
    expected_branch: str,
) -> OnboardingResult:
    """Filesystem + git probes. Errors when the path isn't a usable git repo."""
    errors: list[str] = []
    warnings: list[str] = []

    p = Path(local_path).expanduser()
    if not p.exists():
        return OnboardingResult(ok=False, errors=[f"local_path does not exist: {p}"])
    if not (p / ".git").exists():
        return OnboardingResult(ok=False, errors=[f"local_path is not a git repo: {p}"])

    try:
        url = subprocess.check_output(
            ["git", "-C", str(p), "remote", "get-url", "origin"],
            text=True, stderr=subprocess.STDOUT, timeout=5,
        ).strip()
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as e:
        errors.append(f"could not read git remote 'origin': {e}")
        url = ""

    if url:
        expected = f"{expected_owner}/{expected_repo}"
        if expected not in url:
            errors.append(f"git remote {url!r} does not match expected {expected!r}")

    try:
        branches = subprocess.check_output(
            ["git", "-C", str(p), "branch", "-a"],
            text=True, stderr=subprocess.STDOUT, timeout=5,
        ).splitlines()
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as e:
        warnings.append(f"could not list branches: {e}")
        branches = []
    if branches and not any(expected_branch in b for b in branches):
        errors.append(f"default_branch {expected_branch!r} not present locally; fetch first?")

    if errors:
        return OnboardingResult(ok=False, errors=errors, warnings=warnings)
    return OnboardingResult(ok=True, warnings=warnings)


def append_to_registry(spec: dict[str, Any], *, path: Path | None = None) -> RepoEntry:
    """Append a validated spec to repos.yaml; create the file if absent.
    Returns the parsed RepoEntry. Caller should run ``sync_to_db()``."""
    yaml_path = path or default_repos_path()
    yaml_path.parent.mkdir(parents=True, exist_ok=True)
    if yaml_path.exists():
        existing = yaml.safe_load(yaml_path.read_text(encoding="utf-8")) or {}
    else:
        existing = {}
    if not isinstance(existing, dict):
        raise ValueError("existing repos.yaml is not a mapping")
    repos = existing.get("repos") or []
    if not isinstance(repos, list):
        raise ValueError("existing repos.yaml: 'repos' is not a list")
    repos.append(spec)
    existing["repos"] = repos
    yaml_path.write_text(yaml.safe_dump(existing, sort_keys=False), encoding="utf-8")

    # re-parse to get the canonical entry (with defaults merged + tilde
    # expansion + risk_level normalization).
    entries = parse_registry(yaml_path.read_text(encoding="utf-8"))
    matching = [e for e in entries if e.id == spec["id"]]
    if not matching:
        raise RuntimeError("registry write succeeded but entry not found after re-parse")
    return matching[0]


def onboard(spec: dict[str, Any], *, probe_local: bool = True) -> OnboardingResult:
    """End-to-end: validate spec, optionally probe git, write registry, sync DB."""
    existing = {e.id for e in load_registry()}
    result = validate_spec(spec, existing_ids=existing)
    if not result.ok:
        return result
    if probe_local:
        probe = probe_local_path(
            spec["local_path"], spec["github_owner"], spec["github_repo"],
            spec.get("default_branch", "main"),
        )
        if not probe.ok:
            result.ok = False
            result.errors.extend(probe.errors)
        result.warnings.extend(probe.warnings)
        if not result.ok:
            return result
    entry = append_to_registry(spec)
    sync_to_db(load_registry())
    result.entry = entry
    return result
