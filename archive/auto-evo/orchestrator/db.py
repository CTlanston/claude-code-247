"""Minimal SQLite state machine. Swap to Postgres + SQLAlchemy if you outgrow it."""
from __future__ import annotations

import json
import os
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

# /state inside Docker; ~/.claude-247-state on the host in LOCAL_MODE.
# Honour STATE_DIR env if set.
if os.getenv("STATE_DIR"):
    STATE_DIR = Path(os.environ["STATE_DIR"])
elif os.getenv("LOCAL_MODE", "0") == "1":
    STATE_DIR = Path.home() / ".claude-247-state"
else:
    STATE_DIR = Path("/state")
DB_PATH = STATE_DIR / "orchestrator.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS tasks (
    issue_id INTEGER PRIMARY KEY,
    repo TEXT NOT NULL,
    status TEXT NOT NULL,
    branch TEXT,
    credit INTEGER DEFAULT 100,
    review_rounds INTEGER DEFAULT 0,
    plan_json TEXT,
    last_error TEXT,
    created_at REAL,
    updated_at REAL
);

CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_id INTEGER,
    role TEXT,
    started_at REAL,
    finished_at REAL,
    exit_code INTEGER,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cost_usd REAL,
    summary TEXT
);

CREATE TABLE IF NOT EXISTS metrics (
    bucket_at INTEGER PRIMARY KEY,
    token_total INTEGER DEFAULT 0,
    cost_usd REAL DEFAULT 0,
    ci_pass INTEGER DEFAULT 0,
    ci_fail INTEGER DEFAULT 0,
    review_request_changes INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at REAL,
    actor TEXT,
    action TEXT,
    detail TEXT
);
"""


def init() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with conn() as c:
        c.executescript(SCHEMA)


@contextmanager
def conn():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(DB_PATH, timeout=10)
    c.row_factory = sqlite3.Row
    try:
        yield c
        c.commit()
    finally:
        c.close()


def upsert_task(issue_id: int, repo: str, status: str, **kwargs) -> None:
    now = time.time()
    with conn() as c:
        row = c.execute("SELECT issue_id FROM tasks WHERE issue_id=?", (issue_id,)).fetchone()
        if row:
            sets = ", ".join(f"{k}=?" for k in kwargs)
            c.execute(
                f"UPDATE tasks SET status=?, updated_at=?{', ' + sets if sets else ''} WHERE issue_id=?",
                (status, now, *kwargs.values(), issue_id),
            )
        else:
            cols = ["issue_id", "repo", "status", "created_at", "updated_at", *kwargs.keys()]
            vals = [issue_id, repo, status, now, now, *kwargs.values()]
            placeholders = ",".join(["?"] * len(cols))
            c.execute(f"INSERT INTO tasks ({','.join(cols)}) VALUES ({placeholders})", vals)


def get_task(issue_id: int):
    with conn() as c:
        row = c.execute("SELECT * FROM tasks WHERE issue_id=?", (issue_id,)).fetchone()
        return dict(row) if row else None


def list_tasks_by_status(status: str):
    with conn() as c:
        rows = c.execute("SELECT * FROM tasks WHERE status=? ORDER BY updated_at ASC", (status,)).fetchall()
        return [dict(r) for r in rows]


def deduct_credit(issue_id: int, points: int, reason: str) -> int:
    with conn() as c:
        c.execute("UPDATE tasks SET credit = credit - ? WHERE issue_id=?", (points, issue_id))
        row = c.execute("SELECT credit FROM tasks WHERE issue_id=?", (issue_id,)).fetchone()
        c.execute(
            "INSERT INTO audit (at, actor, action, detail) VALUES (?, 'system', 'credit_deduct', ?)",
            (time.time(), json.dumps({"issue_id": issue_id, "points": points,
                                      "reason": reason, "remaining": row["credit"]})),
        )
        return row["credit"]


def record_run(issue_id: int, role: str, started_at: float, finished_at: float,
               exit_code: int, in_tokens: int, out_tokens: int, cost: float, summary: str) -> None:
    # --- Fix 1 (zero-token zero-cost guard) ---------------------------------
    # Under OAuth/subscription, the CLI sometimes returns a non-zero
    # total_cost_usd estimate even when no tokens flowed (rate-limit early-out,
    # retry headers, etc.). Writing that as real cost accumulates phantom
    # dollars; Guardian reads them as a token spike and pauses dispatch.
    # E2E 2026-05-11 confirmed 2 phantom rows added during the test.
    #
    # V4: extend the guard via the central billable.to_billable_cost helper.
    # Under subscription mode (CLAUDE_CODE_OAUTH_TOKEN or sk-ant-oat01- prefix)
    # the cost field is force-zeroed BEFORE it ever enters the runs table.
    # That kills the Guardian-reads-raw-DB-cost false-pause loop at source
    # instead of trying to mask it downstream.
    try:
        from . import billable as _billable
    except ImportError:
        import billable as _billable  # type: ignore
    cost = _billable.to_billable_cost(cost, in_tokens=in_tokens, out_tokens=out_tokens)

    # --- Fix 2 (idempotent INSERT) ------------------------------------------
    # Retries used to duplicate rows with the same (issue_id, role, started_at)
    # AND the previous run's stale cost. Six-times duplication of $0.19 was the
    # canonical symptom. Drop the write if the natural key already exists.
    with conn() as c:
        if c.execute(
            "SELECT 1 FROM runs WHERE issue_id=? AND role=? AND started_at=? LIMIT 1",
            (issue_id, role, started_at),
        ).fetchone():
            return
        c.execute(
            "INSERT INTO runs (issue_id, role, started_at, finished_at, exit_code, "
            "input_tokens, output_tokens, cost_usd, summary) VALUES (?,?,?,?,?,?,?,?,?)",
            (issue_id, role, started_at, finished_at, exit_code, in_tokens, out_tokens, cost, summary),
        )
        bucket = int(finished_at // 300)
        c.execute(
            "INSERT INTO metrics (bucket_at, token_total, cost_usd) VALUES (?,?,?) "
            "ON CONFLICT(bucket_at) DO UPDATE SET token_total=token_total+excluded.token_total, "
            "cost_usd=cost_usd+excluded.cost_usd",
            (bucket, (in_tokens or 0) + (out_tokens or 0), cost),
        )


def daily_cost_usd() -> float:
    bucket_start = int((time.time() - 86400) // 300)
    with conn() as c:
        row = c.execute(
            "SELECT COALESCE(SUM(cost_usd), 0) AS s FROM metrics WHERE bucket_at >= ?",
            (bucket_start,),
        ).fetchone()
        return row["s"] or 0.0


def ci_failures_last_hour() -> int:
    bucket_start = int((time.time() - 3600) // 300)
    with conn() as c:
        row = c.execute(
            "SELECT COALESCE(SUM(ci_fail), 0) AS s FROM metrics WHERE bucket_at >= ?",
            (bucket_start,),
        ).fetchone()
        return int(row["s"] or 0)


def audit(actor: str, action: str, detail: dict) -> None:
    with conn() as c:
        c.execute(
            "INSERT INTO audit (at, actor, action, detail) VALUES (?, ?, ?, ?)",
            (time.time(), actor, action, json.dumps(detail)),
        )
