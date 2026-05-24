"""Per-phase worker exit recording + classification (M19/BR-003).

Before this module, dispatcher summaries said ``worker_exit: 3`` with
no easy way to tell whether the claude CLI, docker, git, pytest, the
validator, or the merge gate was the actual blocker. This module
gives every phase boundary a place to write:

  - phase + role               (what was happening)
  - command + exit_code        (the actual invocation)
  - duration_ms                (how long it ran)
  - classification             (one of the canonical labels)
  - stdout_tail / stderr_tail  (enough context to root-cause)
  - retryable + next_action    (what the operator can do)

Callers should record both success and failure transitions: that's how
``explain-stuck`` and the dashboard can answer "what stopped you".

The classifier is a heuristic over (phase, exit_code, stderr_tail,
command). When in doubt it returns ``unknown_failure`` rather than
guessing a wrong specific label — debugging an unknown is easier than
debugging a confidently-mislabelled one.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from memory.db import open_db
from orchestrator.ids import make_id, utc_now_iso

# Allowed classification labels. Mirrored in the directive § Phase 3.
CLASSIFICATIONS: frozenset[str] = frozenset({
    "success",
    "test_failure",
    "lint_failure",
    "build_failure",
    "claude_cli_failure",
    "auth_failure",
    "docker_failure",
    "git_failure",
    "github_failure",
    "validator_failure",
    "merge_policy_block",
    "timeout",
    "policy_block",
    "unknown_failure",
})


@dataclass(frozen=True)
class WorkerExit:
    """Read-side view of a worker_exits row."""
    id: str
    created_at: str
    task_id: str
    repo_id: str
    run_id: str | None
    worker_role: str
    phase: str
    command: str | None
    exit_code: int | None
    duration_ms: int | None
    classification: str
    stdout_tail: str | None
    stderr_tail: str | None
    error_message: str | None
    retryable: bool
    next_action: str | None
    payload: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "created_at": self.created_at,
            "task_id": self.task_id,
            "repo_id": self.repo_id,
            "run_id": self.run_id,
            "worker_role": self.worker_role,
            "phase": self.phase,
            "command": self.command,
            "exit_code": self.exit_code,
            "duration_ms": self.duration_ms,
            "classification": self.classification,
            "stdout_tail": self.stdout_tail,
            "stderr_tail": self.stderr_tail,
            "error_message": self.error_message,
            "retryable": self.retryable,
            "next_action": self.next_action,
            "payload": self.payload,
        }


def record_worker_exit(
    *,
    task_id: str,
    repo_id: str,
    worker_role: str,
    phase: str,
    classification: str,
    command: str | None = None,
    exit_code: int | None = None,
    duration_ms: int | None = None,
    stdout_tail: str | None = None,
    stderr_tail: str | None = None,
    error_message: str | None = None,
    retryable: bool = False,
    next_action: str | None = None,
    payload: dict[str, Any] | None = None,
    run_id: str | None = None,
    db_path: Path | str | None = None,
) -> WorkerExit:
    """Insert one row into ``worker_exits``. Raises ``ValueError`` on
    an unknown classification (typos are the most common bug here, and
    silently dropping them would erode the contract)."""
    if classification not in CLASSIFICATIONS:
        raise ValueError(
            f"unknown classification {classification!r}; "
            f"must be one of {sorted(CLASSIFICATIONS)}"
        )
    we_id = make_id("we")
    now = utc_now_iso()
    payload_json = json.dumps(payload or {}, sort_keys=True)
    with open_db(db_path) as conn:
        conn.execute(
            """
            INSERT INTO worker_exits (
              id, created_at, task_id, repo_id, run_id, worker_role, phase,
              command, exit_code, duration_ms, classification, stdout_tail,
              stderr_tail, error_message, retryable, next_action, payload_json
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                we_id, now, task_id, repo_id, run_id, worker_role, phase,
                command, exit_code, duration_ms, classification,
                stdout_tail, stderr_tail, error_message,
                1 if retryable else 0, next_action, payload_json,
            ),
        )
    return WorkerExit(
        id=we_id, created_at=now, task_id=task_id, repo_id=repo_id,
        run_id=run_id, worker_role=worker_role, phase=phase,
        command=command, exit_code=exit_code, duration_ms=duration_ms,
        classification=classification, stdout_tail=stdout_tail,
        stderr_tail=stderr_tail, error_message=error_message,
        retryable=retryable, next_action=next_action,
        payload=payload or {},
    )


def list_worker_exits(
    *,
    task_id: str,
    limit: int | None = None,
    db_path: Path | str | None = None,
) -> list[WorkerExit]:
    """Return rows for a task in chronological order (oldest first)."""
    query = (
        "SELECT id, created_at, task_id, repo_id, run_id, worker_role, phase, "
        "command, exit_code, duration_ms, classification, stdout_tail, "
        "stderr_tail, error_message, retryable, next_action, payload_json "
        "FROM worker_exits WHERE task_id = ? ORDER BY created_at ASC"
    )
    params: tuple = (task_id,)
    if limit is not None:
        query += " LIMIT ?"
        params = (task_id, int(limit))
    with open_db(db_path) as conn:
        rows = conn.execute(query, params).fetchall()
    return [_row_to_exit(r) for r in rows]


def _row_to_exit(row: Any) -> WorkerExit:
    try:
        payload = json.loads(row["payload_json"] or "{}")
    except (TypeError, json.JSONDecodeError):
        payload = {}
    return WorkerExit(
        id=row["id"], created_at=row["created_at"],
        task_id=row["task_id"], repo_id=row["repo_id"],
        run_id=row["run_id"], worker_role=row["worker_role"],
        phase=row["phase"], command=row["command"],
        exit_code=row["exit_code"], duration_ms=row["duration_ms"],
        classification=row["classification"],
        stdout_tail=row["stdout_tail"], stderr_tail=row["stderr_tail"],
        error_message=row["error_message"],
        retryable=bool(row["retryable"]),
        next_action=row["next_action"],
        payload=payload,
    )


# ── classifier ────────────────────────────────────────────────────────────


def classify_failure(
    *,
    phase: str,
    exit_code: int | None,
    command: str | None,
    stderr_tail: str | None,
    verdict: str | None = None,
) -> str:
    """Map a phase boundary's observable state to a canonical label.

    Order of checks matters: more-specific labels (merge_policy_block,
    timeout, auth_failure) must run before the broad command-shape
    classifiers (claude_cli_failure, github_failure) because, e.g., a
    failing ``claude --print`` with "authentication required" in
    stderr is fundamentally an *auth* problem, not a CLI problem.
    """
    cmd = (command or "").strip()
    err = (stderr_tail or "").lower()

    # Special: merge_policy doesn't run a subprocess. It returns a verdict.
    if phase == "merge_policy":
        if (verdict or "").upper() == "BLOCKED":
            return "merge_policy_block"
        if exit_code in (None, 0):
            return "success"
        return "policy_block"

    # Special: timeouts. Either a 124 exit (timeout(1)) or our own
    # marker text emitted by evidence_collector on subprocess.TimeoutExpired.
    if exit_code == 124 or "timeout" in err:
        return "timeout"

    # Success comes after timeout so a 0-exit + timeout marker doesn't slip.
    if exit_code in (0, None) and not err:
        return "success"

    # Auth failures win over CLI/github specifics because they need
    # different remediation (re-auth) than a CLI bug.
    auth_markers = (
        "authentication required",
        "not authenticated",
        "401 unauthorized",
        "403 forbidden",
        "bad credentials",
        "auth error",
    )
    if any(m in err for m in auth_markers):
        return "auth_failure"

    # Command-shape classification.
    head = cmd.split()[0] if cmd else ""
    if head.endswith("/claude") or head == "claude":
        return "claude_cli_failure"
    if head == "gh":
        return "github_failure"
    if head == "git":
        return "git_failure"
    if "docker" in cmd or "docker daemon" in err or "cannot connect to the docker daemon" in err:
        return "docker_failure"

    # Phase-based fallback.
    if phase == "tests":
        return "test_failure"
    if phase == "lint":
        return "lint_failure"
    if phase == "build":
        return "build_failure"
    if phase in ("validate", "validator"):
        return "validator_failure"
    if phase == "policy" or phase == "policy_check":
        return "policy_block"

    return "unknown_failure"
