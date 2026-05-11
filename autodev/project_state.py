"""ProjectState — atomic read/write of `reports/state.json`.

The supervisor state machine treats this as its only persistent memory at
the supervisor level. The inner Auto-Evo engine has its own SQLite state
(`state/orchestrator.db`); we don't try to merge — we mirror only the
fields the outer loop actually needs (`current_task_id`, `current_phase`,
`branch`, last-known test/CI/Guardian results).

Atomicity: every write goes through a tmpfile + `os.replace()` rename so a
crash mid-write never leaves the file half-baked. If the existing file is
corrupt JSON, we back it up under `state.corrupt.<ts>.json` and reinitialise
to safe defaults.
"""
from __future__ import annotations

import json
import os
import shutil
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Optional

# Default location — resolved relative to repo root via $AUTODEV_REPORTS_DIR
# when set, else `<project>/reports/`. We compute project root by walking up
# from this file until we find one of the marker dirs.
_THIS = Path(__file__).resolve()


def _project_root() -> Path:
    # autodev/project_state.py → project root is parent.parent
    return _THIS.parent.parent


def reports_dir() -> Path:
    env = os.getenv("AUTODEV_REPORTS_DIR")
    return Path(env) if env else _project_root() / "reports"


def state_path() -> Path:
    return reports_dir() / "state.json"


# Spec §6 schema. Any new field must default-safely.
SCHEMA_DEFAULTS: dict[str, Any] = {
    "version": 1,
    "mode": "cheap",
    "status": "idle",
    "paused": False,
    "live_allowed": False,
    "autostart_allowed": False,
    "current_task_id": None,
    "current_task_title": None,
    "current_phase": None,
    "branch": None,
    "worktree": None,
    "last_completed_step": None,
    "next_action": None,
    "last_test_command": None,
    "last_test_result": None,
    "last_ci_result": None,
    "last_guardian_result": None,
    "last_commit": None,
    "last_pr": None,
    "blocked": False,
    "blocker_reason": None,
    "human_needed": False,
    "cost_mode": "cheap",
    "api_spend_allowed": False,
    "api_spend_today_usd": 0.0,
    "repair_attempts_for_current_task": 0,
    "updated_at": None,
    "health_status": "unknown",
}


class ProjectState:
    """Read / mutate / save `reports/state.json`.

    Use as:

        with ProjectState() as s:
            s["current_phase"] = "coding"
            s.touch()  # update updated_at; save on context exit

    or imperatively:

        s = ProjectState.load()
        s["paused"] = True
        s.save()
    """

    def __init__(self, data: Optional[dict] = None, path: Optional[Path] = None):
        self._path = Path(path) if path else state_path()
        self._data: dict[str, Any] = dict(SCHEMA_DEFAULTS)
        if data:
            self._data.update(data)

    # ----- read -----------------------------------------------------------

    @classmethod
    def load(cls, path: Optional[Path] = None) -> "ProjectState":
        p = Path(path) if path else state_path()
        if not p.exists():
            inst = cls(path=p)
            inst.save()
            return inst
        try:
            raw = json.loads(p.read_text())
            if not isinstance(raw, dict):
                raise ValueError("state.json is not an object")
        except (json.JSONDecodeError, ValueError, OSError):
            cls._backup_corrupt(p)
            inst = cls(path=p)
            inst.save()
            return inst
        merged = dict(SCHEMA_DEFAULTS)
        merged.update(raw)
        return cls(data=merged, path=p)

    @staticmethod
    def _backup_corrupt(p: Path) -> None:
        if not p.exists():
            return
        ts = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
        backup = p.with_suffix(f".corrupt.{ts}.json")
        try:
            shutil.copy2(p, backup)
        except OSError:
            pass

    # ----- mutate ---------------------------------------------------------

    def __getitem__(self, key: str) -> Any:
        return self._data.get(key)

    def __setitem__(self, key: str, value: Any) -> None:
        self._data[key] = value

    def __contains__(self, key: str) -> bool:
        return key in self._data

    def get(self, key: str, default: Any = None) -> Any:
        return self._data.get(key, default)

    def update(self, **changes: Any) -> "ProjectState":
        self._data.update(changes)
        return self

    def touch(self) -> "ProjectState":
        self._data["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        return self

    # ----- save -----------------------------------------------------------

    def save(self) -> None:
        self.touch()
        self._path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self._path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self._data, indent=2, sort_keys=True) + "\n")
        os.replace(tmp, self._path)

    # ----- contextmanager ------------------------------------------------

    def __enter__(self) -> "ProjectState":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        if exc_type is None:
            self.save()

    # ----- dict-ish ------------------------------------------------------

    def as_dict(self) -> dict[str, Any]:
        return dict(self._data)


# ----- module-level convenience ------------------------------------------

def load_state(path: Optional[Path] = None) -> ProjectState:
    return ProjectState.load(path)


@contextmanager
def open_state(path: Optional[Path] = None):
    s = ProjectState.load(path)
    try:
        yield s
    finally:
        s.save()
