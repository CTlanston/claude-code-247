"""Per-repo durable memory — the ``.agent/`` markdown files.

Spec §17.2 lists eight files. We keep them all under the registered repo's
``local_path/.agent/`` so they ship with the repo (the operator can
.gitignore individual ones if they don't want them tracked).

Reading is gentle: missing files return empty strings, not exceptions.
Writing is idempotent and creates ``.agent/`` on demand.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

CANONICAL_FILES = (
    "PROJECT_PROFILE",
    "ARCHITECTURE",
    "DECISIONS",
    "FAILURES",
    "RUNBOOK",
    "REVIEW_LESSONS",
    "STYLE_GUIDE",
    "KNOWN_PITFALLS",
)


@dataclass(frozen=True)
class AgentMemory:
    repo_path: Path

    @property
    def agent_dir(self) -> Path:
        return self.repo_path / ".agent"

    def path(self, name: str) -> Path:
        name = name.upper().removesuffix(".MD")
        if name not in CANONICAL_FILES:
            raise ValueError(f"unknown memory file {name!r}; "
                              f"allowed: {CANONICAL_FILES}")
        return self.agent_dir / f"{name}.md"

    def read(self, name: str) -> str:
        p = self.path(name)
        return p.read_text(encoding="utf-8") if p.exists() else ""

    def write(self, name: str, body: str) -> Path:
        p = self.path(name)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(body, encoding="utf-8")
        return p

    def append(self, name: str, body: str) -> Path:
        """Append (with a blank line separator) to an existing file or
        create a new one if absent."""
        current = self.read(name)
        joined = (current.rstrip() + "\n\n" + body.lstrip()) if current else body
        return self.write(name, joined)

    def summary(self) -> dict[str, int]:
        """Return file → size-in-bytes for each canonical file present."""
        out: dict[str, int] = {}
        for name in CANONICAL_FILES:
            p = self.path(name)
            if p.exists():
                out[name] = p.stat().st_size
        return out

    def initialize_if_missing(self) -> list[Path]:
        """Create empty stubs for any missing files. Returns the created
        paths. Used by the onboarding wizard."""
        created: list[Path] = []
        for name in CANONICAL_FILES:
            p = self.path(name)
            if not p.exists():
                p.parent.mkdir(parents=True, exist_ok=True)
                header = f"# {name.replace('_', ' ').title()}\n\n_(auto-created)_\n"
                p.write_text(header, encoding="utf-8")
                created.append(p)
        return created
