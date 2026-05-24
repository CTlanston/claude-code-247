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
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterator

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
    # M21-P2: phase lifecycle fields
    status: str | None = None
    started_at: str | None = None
    finished_at: str | None = None
    error_type: str | None = None

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
            "status": self.status,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "error_type": self.error_type,
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
    status: str | None = None,
    started_at: str | None = None,
    finished_at: str | None = None,
    error_type: str | None = None,
    db_path: Path | str | None = None,
) -> WorkerExit:
    """Insert one row into ``worker_exits``. Raises ``ValueError`` on
    an unknown classification (typos are the most common bug here, and
    silently dropping them would erode the contract).

    M21-P2: ``status`` / ``started_at`` / ``finished_at`` / ``error_type``
    are optional lifecycle fields. ``record_phase()`` populates them
    for free; direct callers may leave them None.
    """
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
              stderr_tail, error_message, retryable, next_action, payload_json,
              status, started_at, finished_at, error_type
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                we_id, now, task_id, repo_id, run_id, worker_role, phase,
                command, exit_code, duration_ms, classification,
                stdout_tail, stderr_tail, error_message,
                1 if retryable else 0, next_action, payload_json,
                status, started_at, finished_at, error_type,
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
        status=status, started_at=started_at, finished_at=finished_at,
        error_type=error_type,
    )


# ── M21-P2: phase recording context manager ──────────────────────────────


@dataclass
class _PhaseRecord:
    """Mutable state shared with the ``record_phase()`` caller. Settable
    fields let the caller attach metadata, override classification,
    or mark the phase as skipped."""
    task_id: str
    repo_id: str
    worker_role: str
    phase: str
    started_at: str
    metadata: dict[str, Any] = field(default_factory=dict)
    classification: str = "success"
    status: str = "in_progress"
    exit_code: int | None = None
    command: str | None = None
    next_action: str | None = None
    error_message: str | None = None
    error_type: str | None = None
    run_id: str | None = None

    def skip(self, reason: str) -> None:
        """Mark this phase as skipped (e.g., when a precondition isn't met)."""
        self.status = "skipped"
        self.classification = "success"
        self.exit_code = 0
        self.metadata["skip_reason"] = reason

    def fail(self, *, classification: str, error_type: str | None = None,
             error_message: str | None = None, exit_code: int = -1) -> None:
        """Mark this phase as a failure explicitly (when not using exceptions)."""
        self.status = "failure"
        self.classification = classification
        self.error_type = error_type
        self.error_message = error_message
        self.exit_code = exit_code


@contextmanager
def record_phase(
    *,
    task_id: str,
    repo_id: str,
    phase: str,
    worker_role: str = "dispatcher",
    run_id: str | None = None,
    db_path: Path | str | None = None,
) -> Iterator[_PhaseRecord]:
    """Bracket a phase with a worker_exits row.

    Usage::

        with record_phase(task_id=t, repo_id=r, phase="push") as rec:
            rec.command = "git push origin agent/x"
            runner.push_branch(prep)

    On exception: the row is written with status=failure, classification
    inferred from the exception class, error_type=class name, error_message
    = str(exc), exit_code=-1, finished_at=now. The exception is re-raised.

    On normal exit (status not explicitly set to "skipped" or "failure"):
    status defaults to "success", classification="success", exit_code=0.

    The recorder is best-effort: a database failure inside the with-block
    must NOT shadow the original exception. If recording itself fails
    we silently drop the row and let the user-facing flow continue.
    """
    rec = _PhaseRecord(
        task_id=task_id, repo_id=repo_id, worker_role=worker_role,
        phase=phase, started_at=utc_now_iso(),
        run_id=run_id,
    )
    raised: BaseException | None = None
    try:
        yield rec
    except BaseException as e:  # includes KeyboardInterrupt / SystemExit
        raised = e
        if rec.status == "in_progress":
            rec.status = "failure"
            rec.error_type = type(e).__name__
            rec.error_message = str(e)[:1000]
            rec.exit_code = -1
            rec.classification = _classification_for_exception(e, phase, rec.command)
    finally:
        finished = utc_now_iso()
        if rec.status == "in_progress":
            rec.status = "success"
            rec.classification = rec.classification or "success"
            rec.exit_code = 0 if rec.exit_code is None else rec.exit_code
        try:
            _emit_phase_row(rec, finished_at=finished, db_path=db_path)
        except Exception:  # pragma: no cover — observability never breaks flow
            pass
        if raised is not None:
            raise raised


def _emit_phase_row(rec: _PhaseRecord, *, finished_at: str,
                     db_path: Path | str | None) -> None:
    duration_ms = _iso_delta_ms(rec.started_at, finished_at)
    record_worker_exit(
        task_id=rec.task_id, repo_id=rec.repo_id,
        worker_role=rec.worker_role, phase=rec.phase,
        classification=rec.classification,
        command=rec.command,
        exit_code=rec.exit_code,
        duration_ms=duration_ms,
        error_message=rec.error_message,
        next_action=rec.next_action,
        payload=dict(rec.metadata),
        run_id=rec.run_id,
        status=rec.status,
        started_at=rec.started_at,
        finished_at=finished_at,
        error_type=rec.error_type,
        db_path=db_path,
    )


def _classification_for_exception(exc: BaseException, phase: str,
                                    command: str | None) -> str:
    """Map an exception class + phase to one of the canonical labels.
    Reuses ``classify_failure``'s heuristics with the exception type as
    a tiebreaker. Always returns a valid label."""
    name = type(exc).__name__.lower()
    if "timeout" in name:
        return "timeout"
    if any(k in name for k in ("auth", "permission", "denied")):
        return "auth_failure"
    return classify_failure(
        phase=phase, exit_code=-1, command=command,
        stderr_tail=f"{type(exc).__name__}: {exc}",
    )


def _iso_delta_ms(start: str, end: str) -> int | None:
    """Return the millisecond delta between two ISO-8601 timestamps.
    Returns None if either string can't be parsed (we never raise from
    a phase record).
    """
    from datetime import datetime
    try:
        t0 = datetime.fromisoformat(start.replace("Z", "+00:00"))
        t1 = datetime.fromisoformat(end.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return int((t1 - t0).total_seconds() * 1000)


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
        "stderr_tail, error_message, retryable, next_action, payload_json, "
        "status, started_at, finished_at, error_type "
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
    # M21-P2 columns may be NULL on rows written by the pre-migration
    # recorder — sqlite3.Row supports both subscript and dict() pull but
    # only for columns that exist in the SELECT. The query in
    # list_worker_exits explicitly enumerates them, so they're always
    # present here; we defensively coerce missing→None anyway.
    def _get(name: str):
        try:
            return row[name]
        except (IndexError, KeyError):
            return None
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
        status=_get("status"),
        started_at=_get("started_at"),
        finished_at=_get("finished_at"),
        error_type=_get("error_type"),
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
