"""Repo registry — parse ``repos.yaml`` and mirror to SQLite.

``~/.claude-code-247/repos.yaml`` is the canonical store. The SQLite
``repos`` table is a cache so we can join task / pr / risk rows against
repo metadata cheaply.

Parsing is strict on the high-level structure (top-level ``repos:`` list,
each item is a dict, ``id`` is required) and lenient about extra fields
(stored in ``config_json`` for future use). Errors carry the offending key
so the operator can fix the file.

This module is the only thing that should ever write to the ``repos``
table; everything else reads.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from memory.db import open_db
from orchestrator.config import default_config_dir, load_config
from orchestrator.ids import utc_now_iso

REPOS_YAML_NAME = "repos.yaml"
REPOS_YAML_ENV = "CLAUDE247_REPOS_FILE"


class RepoRegistryError(ValueError):
    """Raised for any schema or structural problem in repos.yaml."""


def default_repos_path() -> Path:
    if env := os.environ.get(REPOS_YAML_ENV):
        return Path(env).expanduser()
    return default_config_dir() / REPOS_YAML_NAME


@dataclass(frozen=True)
class RepoEntry:
    id: str
    name: str
    github_owner: str
    github_repo: str
    local_path: str
    default_branch: str
    enabled: bool
    risk_level: str
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def github_full_name(self) -> str:
        return f"{self.github_owner}/{self.github_repo}"


REQUIRED_FIELDS = ("id", "github_owner", "github_repo", "local_path")


def parse_registry(text: str) -> list[RepoEntry]:
    """Parse the YAML body into validated RepoEntry objects."""
    if not text or not text.strip():
        return []
    data = yaml.safe_load(text)
    if data is None:
        return []
    if not isinstance(data, dict):
        raise RepoRegistryError("repos.yaml top-level must be a mapping")
    raw_list = data.get("repos")
    if raw_list is None:
        return []
    if not isinstance(raw_list, list):
        raise RepoRegistryError("repos.yaml: 'repos' must be a list")

    cfg = load_config()
    defaults = cfg.get("repo_defaults", {}) or {}

    entries: list[RepoEntry] = []
    seen_ids: set[str] = set()
    for i, item in enumerate(raw_list):
        if not isinstance(item, dict):
            raise RepoRegistryError(f"repos[{i}] must be a mapping, got {type(item).__name__}")
        merged = {**defaults, **item}
        for fld in REQUIRED_FIELDS:
            if not merged.get(fld):
                raise RepoRegistryError(f"repos[{i}] missing required field: {fld}")
        rid = str(merged["id"])
        if rid in seen_ids:
            raise RepoRegistryError(f"repos[{i}] duplicate id {rid!r}")
        seen_ids.add(rid)

        local_path = str(merged["local_path"])
        if local_path.startswith("~"):
            local_path = str(Path(local_path).expanduser())

        forbidden = merged.get("forbidden_paths") or []
        if not isinstance(forbidden, list) or not forbidden:
            raise RepoRegistryError(
                f"repos[{i}] ({rid}) forbidden_paths must be a non-empty list"
            )

        entries.append(
            RepoEntry(
                id=rid,
                name=str(merged.get("name") or rid),
                github_owner=str(merged["github_owner"]),
                github_repo=str(merged["github_repo"]),
                local_path=local_path,
                default_branch=str(merged.get("default_branch") or "main"),
                enabled=bool(merged.get("enabled", True)),
                risk_level=str(merged.get("risk_level") or "low"),
                raw=merged,
            )
        )
    return entries


def load_registry(path: Path | str | None = None) -> list[RepoEntry]:
    """Load and parse the registry file. Empty list when missing."""
    p = Path(path).expanduser() if path else default_repos_path()
    if not p.exists():
        return []
    return parse_registry(p.read_text(encoding="utf-8"))


def sync_to_db(entries: list[RepoEntry], db_path: Path | str | None = None) -> int:
    """Mirror the YAML entries into the SQLite ``repos`` table. Returns the
    number of rows after the upsert. Removes rows for ids no longer present.
    """
    from memory.db import init_db
    init_db(db_path)
    now = utc_now_iso()
    with open_db(db_path) as conn:
        existing_ids = {row["id"] for row in conn.execute("SELECT id FROM repos")}
        wanted_ids = {e.id for e in entries}

        for entry in entries:
            conn.execute(
                """
                INSERT INTO repos (id, name, github_owner, github_repo, local_path,
                                   default_branch, enabled, risk_level, config_json,
                                   created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    github_owner = excluded.github_owner,
                    github_repo = excluded.github_repo,
                    local_path = excluded.local_path,
                    default_branch = excluded.default_branch,
                    enabled = excluded.enabled,
                    risk_level = excluded.risk_level,
                    config_json = excluded.config_json,
                    updated_at = excluded.updated_at
                """,
                (
                    entry.id,
                    entry.name,
                    entry.github_owner,
                    entry.github_repo,
                    entry.local_path,
                    entry.default_branch,
                    1 if entry.enabled else 0,
                    entry.risk_level,
                    json.dumps(entry.raw, sort_keys=True),
                    now,
                    now,
                ),
            )

        removed = existing_ids - wanted_ids
        for rid in removed:
            conn.execute("DELETE FROM repos WHERE id = ?", (rid,))

        count_row = conn.execute("SELECT COUNT(*) AS c FROM repos").fetchone()
        return int(count_row["c"])
