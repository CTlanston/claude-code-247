"""SQLite state DB wrapper.

Single source of truth for the runtime state machine (tasks, commands, runs,
prs, logs, ...). The schema lives in ``schema.sql`` next to this module.

The DB file lives at ``~/.claude-code-247/state/claude247.db`` by default;
callers can override via ``CLAUDE247_DB_PATH`` env var or ``open_db(path=...)``
for tests.

Connection model is intentionally simple: one connection per call, autocommit
off, with WAL journal mode set in the schema. Concurrency is moderate (a
handful of writers); if it ever becomes a bottleneck, swap for a pool.
"""
from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from importlib import resources
from pathlib import Path
from typing import Iterator

DEFAULT_DB_FILENAME = "claude247.db"
DEFAULT_STATE_DIR_ENV = "CLAUDE247_STATE_DIR"
DEFAULT_DB_PATH_ENV = "CLAUDE247_DB_PATH"


def default_state_dir() -> Path:
    """Return the runtime state directory, creating it if needed."""
    if env := os.environ.get(DEFAULT_STATE_DIR_ENV):
        p = Path(env).expanduser()
    else:
        p = Path.home() / ".claude-code-247" / "state"
    p.mkdir(parents=True, exist_ok=True)
    return p


def default_db_path() -> Path:
    if env := os.environ.get(DEFAULT_DB_PATH_ENV):
        return Path(env).expanduser()
    return default_state_dir() / DEFAULT_DB_FILENAME


def load_schema_sql() -> str:
    """Read the bundled schema.sql as a string."""
    # importlib.resources keeps this working when the package is installed.
    return (resources.files("memory") / "schema.sql").read_text(encoding="utf-8")


def connect(path: Path | str | None = None) -> sqlite3.Connection:
    """Open a connection to the state DB. Creates the file if missing."""
    target = Path(path).expanduser() if path is not None else default_db_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(target), isolation_level=None, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def init_db(path: Path | str | None = None) -> Path:
    """Initialize (or upgrade-in-place) the state DB. Idempotent."""
    target = Path(path).expanduser() if path is not None else default_db_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    with connect(target) as conn:
        conn.executescript(load_schema_sql())
    return target


@contextmanager
def open_db(path: Path | str | None = None) -> Iterator[sqlite3.Connection]:
    """Context-managed connection; always closes."""
    conn = connect(path)
    try:
        yield conn
    finally:
        conn.close()


def schema_version(conn: sqlite3.Connection) -> int | None:
    """Return the highest applied schema version, or None if uninitialised."""
    row = conn.execute("SELECT MAX(version) AS v FROM schema_version").fetchone()
    return row["v"] if row else None
