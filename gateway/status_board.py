"""Read-only watchdog status board.

Aggregates current release + soak + runtime + queue + GA-gate state into
a single immutable snapshot. Used by ``claude247 status-board`` / the
``watchdog`` alias and by the FastAPI ``/status-board`` route.

This module is intentionally side-effect free:

* SQLite access is SELECT-only (``open_db`` + read queries).
* No writes to ``system_state`` and no writes to ``logs``.
* No launchd mutations; ``launchctl list`` is read via ``check_launchd``
  from :mod:`gateway.doctor`.
* The optional dashboard ``/healthz`` probe is a short-timeout GET.

The result data classes carry ``to_dict()`` so the CLI / FastAPI route
can render JSON without reformatting.
"""
from __future__ import annotations

import json
import re
import sqlite3
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from memory.db import open_db
from orchestrator import budget_manager, log_indexer, system_state
from orchestrator.config import load_config
from orchestrator.repo_registry import load_registry

SOAK_REQUIRED_SECONDS = 24 * 60 * 60
ORPHAN_COMMAND_SECONDS = 5 * 60
NEW_ERROR_WINDOW_SECONDS = 60 * 60

LAUNCHD_SERVICES = (
    "com.claude247.dashboard",
    "com.claude247.orchestrator",
    "com.claude247.dispatcher",
    "com.claude247.backup",
)


# ── data classes ─────────────────────────────────────────────────────


@dataclass(frozen=True)
class ReleaseState:
    main_sha: str | None
    implementation_branch_sha: str | None
    ga_tag_exists: bool
    latest_release: str | None
    ga_status: str  # GO | NO-GO | READY | SHIPPED

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class SoakProgress:
    t0: str | None
    elapsed_seconds: int
    required_seconds: int
    progress_percent: int
    result: str  # PASS | PARTIAL | FAIL | UNKNOWN
    earliest_full_check: str | None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class RuntimeHealth:
    launchd_loaded: int
    launchd_expected: int
    dispatcher: str  # healthy | stale | down | unknown
    dashboard: str  # healthy | unreachable | unknown
    notifier: str  # healthy | not_configured | unknown
    doctor: str  # ok | fail | unknown

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class QueueState:
    repos_enabled: int
    active_tasks: int
    stuck_tasks: int
    need_approval: int
    orphan_commands: int
    pending_commands: int

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class Signals:
    new_critical_errors: int
    known_historical_errors: int
    alert_storm: bool
    budget_sane: bool
    logs_searchable: bool

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class GaGates:
    passed: int
    total: int
    blocked: list[str] = field(default_factory=list)
    recommendation: str = "unknown"

    def to_dict(self) -> dict[str, Any]:
        return {
            "passed": self.passed,
            "total": self.total,
            "blocked": list(self.blocked),
            "recommendation": self.recommendation,
        }


@dataclass(frozen=True)
class UsageStats:
    runs_total: int
    runs_today: int
    runs_last_hour: int
    active_workers: int
    by_role: dict[str, int] = field(default_factory=dict)
    by_auth_mode: dict[str, int] = field(default_factory=dict)
    estimated_cost_today_usd: float = 0.0
    estimated_cost_total_usd: float = 0.0
    note: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "runs_total": self.runs_total,
            "runs_today": self.runs_today,
            "runs_last_hour": self.runs_last_hour,
            "active_workers": self.active_workers,
            "by_role": dict(self.by_role),
            "by_auth_mode": dict(self.by_auth_mode),
            "estimated_cost_today_usd": self.estimated_cost_today_usd,
            "estimated_cost_total_usd": self.estimated_cost_total_usd,
            "note": self.note,
        }


@dataclass(frozen=True)
class StatusBoard:
    generated_at: str
    release_state: ReleaseState
    soak: SoakProgress
    runtime_health: RuntimeHealth
    queue: QueueState
    signals: Signals
    ga_gates: GaGates
    usage: UsageStats

    def to_dict(self) -> dict[str, Any]:
        return {
            "generated_at": self.generated_at,
            "release_state": self.release_state.to_dict(),
            "soak": self.soak.to_dict(),
            "runtime_health": self.runtime_health.to_dict(),
            "queue": self.queue.to_dict(),
            "signals": self.signals.to_dict(),
            "ga_gates": self.ga_gates.to_dict(),
            "usage": self.usage.to_dict(),
        }


# ── helpers ──────────────────────────────────────────────────────────


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _repo_root(start: Path | None = None) -> Path:
    """Resolve the repo root by walking up for a ``.git`` dir.

    Falls back to the module's enclosing directory's parent so that even
    when running outside a checkout (e.g. installed wheel) we still pick
    a sane default. Status-board only *reads* files under this root, so
    a wrong guess simply means missing optional inputs (T0, GA_GATE).
    """
    base = (start or Path(__file__)).resolve()
    for p in (base, *base.parents):
        if (p / ".git").exists():
            return p
    return Path(__file__).resolve().parent.parent


# ── release state ────────────────────────────────────────────────────


def _git(args: list[str], cwd: Path) -> str | None:
    import subprocess
    try:
        proc = subprocess.run(
            ["git", *args], cwd=str(cwd), capture_output=True, text=True,
            timeout=3.0,
        )
    except (FileNotFoundError, OSError, subprocess.TimeoutExpired):
        return None
    if proc.returncode != 0:
        return None
    out = proc.stdout.strip()
    return out or None


def collect_release_state(repo_root: Path | None = None) -> ReleaseState:
    root = repo_root or _repo_root()
    main_sha = _git(["rev-parse", "main"], root)
    impl_sha = _git(["rev-parse", "claude247/v1"], root) or _git(["rev-parse", "HEAD"], root)
    ga_tag_exists = bool(_git(["tag", "--list", "v1.0.0"], root))
    latest_release = _git(["describe", "--tags", "--abbrev=0"], root)
    if ga_tag_exists:
        ga_status = "SHIPPED"
    else:
        # Without a tag we can't be GO; the explicit READY/NO-GO call
        # is made by ``recommendation`` after the soak + gates are scored.
        ga_status = "NO-GO"
    return ReleaseState(
        main_sha=main_sha,
        implementation_branch_sha=impl_sha,
        ga_tag_exists=ga_tag_exists,
        latest_release=latest_release,
        ga_status=ga_status,
    )


# ── soak progress ────────────────────────────────────────────────────


_T0_PATTERNS = (
    # M20_SOAK_RESULT.md style: "| Dispatcher effective T0 ... | 2026-05-24 ~21:46 UTC |"
    re.compile(
        r"Dispatcher effective T0[^|]*\|\s*(\d{4}-\d{2}-\d{2})\s*~?\s*"
        r"(\d{1,2}):(\d{2})\s*UTC",
        re.IGNORECASE,
    ),
    # M22 style: "M20-P3 dispatcher reload ... | `2026-05-24T21:46Z`"
    re.compile(
        r"dispatcher reload[^`]*`(\d{4}-\d{2}-\d{2})T(\d{1,2}):(\d{2})Z`",
        re.IGNORECASE,
    ),
)


def parse_soak_t0(text: str) -> datetime | None:
    """Extract the dispatcher T0 from a soak/GA markdown file.

    Returns ``None`` when no pattern matches — the caller should report
    soak as UNKNOWN rather than guess.
    """
    for pat in _T0_PATTERNS:
        m = pat.search(text)
        if m:
            y, mo, d = map(int, (m.group(1)[:4], m.group(1)[5:7], m.group(1)[8:10]))
            hh, mm = int(m.group(2)), int(m.group(3))
            return datetime(y, mo, d, hh, mm, tzinfo=timezone.utc)
    return None


def discover_soak_t0(repo_root: Path | None = None) -> datetime | None:
    root = repo_root or _repo_root()
    for name in ("M20_SOAK_RESULT.md", "M22_GA_DECISION_REPORT.md"):
        p = root / name
        if p.is_file():
            try:
                t0 = parse_soak_t0(p.read_text(encoding="utf-8"))
            except OSError:
                t0 = None
            if t0:
                return t0
    return None


def collect_soak_progress(
    *,
    t0_override: datetime | None = None,
    now: datetime | None = None,
    repo_root: Path | None = None,
    runtime_ok: bool = True,
) -> SoakProgress:
    """Compute soak math.

    ``runtime_ok`` lets the caller signal whether the live launchd /
    dashboard / dispatcher checks are healthy. Without that signal,
    elapsed time alone cannot promote a soak to PASS.
    """
    current = now or _now_utc()
    t0 = t0_override or discover_soak_t0(repo_root)
    if t0 is None:
        return SoakProgress(
            t0=None, elapsed_seconds=0, required_seconds=SOAK_REQUIRED_SECONDS,
            progress_percent=0, result="UNKNOWN", earliest_full_check=None,
        )
    elapsed = max(0, int((current - t0).total_seconds()))
    progress = int(min(100, (elapsed * 100) // SOAK_REQUIRED_SECONDS))
    earliest = _iso(t0 + timedelta(seconds=SOAK_REQUIRED_SECONDS))
    if elapsed < SOAK_REQUIRED_SECONDS:
        result = "PARTIAL"
    elif runtime_ok:
        result = "PASS"
    else:
        result = "FAIL"
    return SoakProgress(
        t0=_iso(t0), elapsed_seconds=elapsed,
        required_seconds=SOAK_REQUIRED_SECONDS,
        progress_percent=progress, result=result,
        earliest_full_check=earliest,
    )


# ── runtime health ───────────────────────────────────────────────────


def _launchd_loaded_count() -> int:
    from gateway.doctor import check_launchd
    detail = check_launchd().detail
    loaded = detail.get("loaded") or {}
    return sum(1 for ok in loaded.values() if ok)


def _dispatcher_health() -> str:
    """Classify the dispatcher: healthy / stale / down / unknown.

    The dispatcher runs every 30s under launchd. We use the mtime of
    its ``dispatcher.out.log`` as a liveness proxy — if it hasn't been
    touched in > 5 minutes, the daemon is silent.
    """
    log = Path.home() / ".claude-code-247" / "logs" / "dispatcher.out.log"
    if not log.exists():
        return "unknown"
    try:
        age_s = time.time() - log.stat().st_mtime
    except OSError:
        return "unknown"
    if age_s < 90:
        return "healthy"
    if age_s < 600:
        return "stale"
    return "down"


def _dashboard_health(timeout: float = 2.0) -> str:
    cfg = load_config()
    url = f"http://{cfg.dashboard_host}:{cfg.dashboard_port}/healthz"
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:  # noqa: S310
            body = resp.read().decode("utf-8")
            if resp.status == 200 and json.loads(body).get("ok") is True:
                return "healthy"
    except (urllib.error.URLError, TimeoutError, ValueError, OSError):
        return "unreachable"
    return "unreachable"


def _notifier_health() -> str:
    cfg = load_config()
    topic = (cfg.get("notifications.ntfy.topic") or "").strip()
    return "healthy" if topic else "not_configured"


def _doctor_health() -> str:
    try:
        from gateway.doctor import run_doctor
        _, ok = run_doctor()
    except Exception:  # noqa: BLE001 — doctor must never block the dashboard
        return "unknown"
    return "ok" if ok else "fail"


def collect_runtime_health() -> RuntimeHealth:
    return RuntimeHealth(
        launchd_loaded=_launchd_loaded_count(),
        launchd_expected=len(LAUNCHD_SERVICES),
        dispatcher=_dispatcher_health(),
        dashboard=_dashboard_health(),
        notifier=_notifier_health(),
        doctor=_doctor_health(),
    )


def runtime_is_ok(rh: RuntimeHealth) -> bool:
    """Whether runtime health is good enough to PROMOTE a soak to PASS."""
    return (
        rh.launchd_loaded == rh.launchd_expected
        and rh.dispatcher == "healthy"
        and rh.dashboard == "healthy"
        and rh.doctor == "ok"
    )


# ── queue state ──────────────────────────────────────────────────────


_ACTIVE_TASK_STATUSES = (
    "queued", "planning", "coding", "testing", "reviewing",
    "validating", "pr_created", "auto_merging",
)


def _scalar(conn: sqlite3.Connection, sql: str, args: tuple = ()) -> int:
    row = conn.execute(sql, args).fetchone()
    if row is None:
        return 0
    # Row supports both __getitem__("c") and indexed access.
    try:
        return int(row["c"])
    except (KeyError, IndexError, TypeError):
        return int(row[0] or 0)


def collect_queue_state() -> QueueState:
    try:
        entries = load_registry()
    except Exception:  # noqa: BLE001 — registry missing is "0 enabled"
        entries = []
    enabled = sum(1 for e in entries if e.enabled)
    with open_db() as conn:
        active = 0
        for status in _ACTIVE_TASK_STATUSES:
            active += _scalar(
                conn, "SELECT COUNT(*) AS c FROM tasks WHERE status = ?",
                (status,),
            )
        stuck = _scalar(conn, "SELECT COUNT(*) AS c FROM tasks WHERE status = 'stuck'")
        waiting = _scalar(
            conn,
            "SELECT COUNT(*) AS c FROM tasks WHERE status = 'waiting_for_approval'",
        )
        approvals = _scalar(
            conn,
            "SELECT COUNT(*) AS c FROM commands WHERE status = 'requires_approval'",
        )
        pending = _scalar(
            conn,
            "SELECT COUNT(*) AS c FROM commands "
            "WHERE status IN ('queued','running','requires_approval')",
        )
        cutoff = _iso(_now_utc() - timedelta(seconds=ORPHAN_COMMAND_SECONDS))
        # ``commands`` has no `updated_at` column — a row that's been
        # ``running`` for longer than ORPHAN_COMMAND_SECONDS without
        # finishing is "orphan" by definition, regardless of how its
        # started_at compares. We coalesce so a command that somehow
        # got status='running' without ever being marked started_at
        # also counts.
        orphans = _scalar(
            conn,
            "SELECT COUNT(*) AS c FROM commands "
            "WHERE status = 'running' AND COALESCE(started_at, created_at) < ?",
            (cutoff,),
        )
    return QueueState(
        repos_enabled=enabled,
        active_tasks=active,
        stuck_tasks=stuck,
        need_approval=waiting + approvals,
        orphan_commands=orphans,
        pending_commands=pending,
    )


# ── signals ──────────────────────────────────────────────────────────


def collect_signals() -> Signals:
    now = _now_utc()
    recent_cutoff = _iso(now - timedelta(seconds=NEW_ERROR_WINDOW_SECONDS))
    with open_db() as conn:
        new_errors = _scalar(
            conn,
            "SELECT COUNT(*) AS c FROM logs WHERE level = 'error' AND created_at >= ?",
            (recent_cutoff,),
        )
        total_errors = _scalar(
            conn, "SELECT COUNT(*) AS c FROM logs WHERE level = 'error'",
        )
        # Alert storm = any single fingerprint hit > 5x in the last hour.
        storm_row = conn.execute(
            "SELECT MAX(count) AS c FROM alerts WHERE last_seen_at >= ?",
            (recent_cutoff,),
        ).fetchone()
        max_count = int(storm_row["c"] or 0) if storm_row else 0
        alert_storm = max_count > 5
    # Budget — verified per repo; "sane" means no exceeded cap today.
    budget_sane = True
    try:
        for entry in load_registry():
            snap = budget_manager.get_snapshot(entry.id).to_dict()
            within, _ = budget_manager.check_caps(
                entry.id, repo_raw={"budget": snap},
            )
            if not within:
                budget_sane = False
                break
    except Exception:  # noqa: BLE001 — registry missing → sane by default
        budget_sane = True
    # Logs searchable: small FTS probe; failure here means schema/triggers
    # got out of sync.
    try:
        log_indexer.search(text="started", limit=1)
        logs_searchable = True
    except Exception:  # noqa: BLE001
        logs_searchable = False
    return Signals(
        new_critical_errors=new_errors,
        known_historical_errors=total_errors,
        alert_storm=alert_storm,
        budget_sane=budget_sane,
        logs_searchable=logs_searchable,
    )


# ── usage stats ──────────────────────────────────────────────────────


def _idle_note(runs_total: int, runs_today: int) -> str:
    """Human-readable annotation for why the numbers look like they look.

    During the 24h soak the system is intentionally idle, so the numbers
    are zero. After GA, real workloads will populate them. The CLAUDE.md
    contract says: subscription-mode runs report run-count only, not a
    USD cost — call that out so the operator doesn't read "$0.00" as a
    failure to instrument.
    """
    if runs_total == 0:
        return "no worker runs yet — system is idle (soak in progress)"
    if runs_today == 0:
        return "no worker runs today — dispatcher queue is empty"
    return ("local Claude Code subscription mode — token counts captured "
            "per run in evidence files; aggregate USD cost is only "
            "populated when auth_mode=anthropic_api")


def collect_usage(*, now: datetime | None = None) -> UsageStats:
    current = now or _now_utc()
    today = current.strftime("%Y-%m-%d")
    today_start = _iso(current.replace(hour=0, minute=0, second=0, microsecond=0))
    hour_ago = _iso(current - timedelta(hours=1))
    with open_db() as conn:
        runs_total = _scalar(conn, "SELECT COUNT(*) AS c FROM runs")
        runs_today = _scalar(
            conn, "SELECT COUNT(*) AS c FROM runs WHERE started_at >= ?",
            (today_start,),
        )
        runs_last_hour = _scalar(
            conn, "SELECT COUNT(*) AS c FROM runs WHERE started_at >= ?",
            (hour_ago,),
        )
        active = _scalar(
            conn,
            "SELECT COUNT(*) AS c FROM runs "
            "WHERE started_at IS NOT NULL AND finished_at IS NULL",
        )
        by_role: dict[str, int] = {}
        for row in conn.execute(
            "SELECT role, COUNT(*) AS c FROM runs GROUP BY role"
        ):
            by_role[row["role"]] = int(row["c"])
        by_auth: dict[str, int] = {}
        for row in conn.execute(
            "SELECT auth_mode, COUNT(*) AS c FROM runs "
            "WHERE auth_mode IS NOT NULL GROUP BY auth_mode"
        ):
            by_auth[row["auth_mode"]] = int(row["c"])
        cost_total = float(conn.execute(
            "SELECT COALESCE(SUM(cost_estimate), 0) AS c FROM runs"
        ).fetchone()["c"] or 0.0)
        # ``budgets.estimated_api_cost`` is per repo per day; sum across
        # repos for today.
        cost_today = float(conn.execute(
            "SELECT COALESCE(SUM(estimated_api_cost), 0) AS c "
            "FROM budgets WHERE date = ?",
            (today,),
        ).fetchone()["c"] or 0.0)
    return UsageStats(
        runs_total=runs_total,
        runs_today=runs_today,
        runs_last_hour=runs_last_hour,
        active_workers=active,
        by_role=by_role,
        by_auth_mode=by_auth,
        estimated_cost_today_usd=round(cost_today, 4),
        estimated_cost_total_usd=round(cost_total, 4),
        note=_idle_note(runs_total, runs_today),
    )


# ── GA gates ─────────────────────────────────────────────────────────


_GA_BLOCKER_HEADING = re.compile(r"^##\s+GA_BLOCKER", re.MULTILINE)
_GA_TABLE_ROW = re.compile(r"^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|")


def parse_ga_blockers(text: str) -> tuple[int, int, list[str]]:
    """Return (passed, total, blocked_titles) from a GA_GATE.md body.

    ``passed`` counts rows whose status cell contains ``✅``;
    ``blocked`` collects the *criterion* short titles for rows that
    don't pass (status ``⏳`` or ``❌``). ``total`` is the row count
    regardless of status.
    """
    m = _GA_BLOCKER_HEADING.search(text)
    if not m:
        return (0, 0, [])
    body = text[m.end():]
    # Stop at the next heading so we don't parse the GA_REQUIRED table.
    next_head = re.search(r"^##\s+", body, re.MULTILINE)
    if next_head:
        body = body[: next_head.start()]
    passed = 0
    total = 0
    blocked: list[str] = []
    for line in body.splitlines():
        row = _GA_TABLE_ROW.match(line)
        if not row:
            continue
        criterion = row.group(2).strip()
        status_cell = row.group(3)
        total += 1
        if "✅" in status_cell:
            passed += 1
        else:
            # Trim noisy markdown for the headline.
            short = criterion.split("—", 1)[0].strip().rstrip(".")
            short = short.replace("`", "")
            if len(short) > 80:
                short = short[:77] + "..."
            blocked.append(short)
    return (passed, total, blocked)


def collect_ga_gates(
    *,
    repo_root: Path | None = None,
    soak: SoakProgress | None = None,
    runtime: RuntimeHealth | None = None,
) -> GaGates:
    root = repo_root or _repo_root()
    p = root / "GA_GATE.md"
    if p.is_file():
        try:
            passed, total, blocked = parse_ga_blockers(p.read_text(encoding="utf-8"))
        except OSError:
            passed, total, blocked = (0, 0, [])
    else:
        passed, total, blocked = (0, 0, [])
    return GaGates(
        passed=passed,
        total=total,
        blocked=blocked,
        recommendation=_recommendation(soak, runtime, passed, total),
    )


def _recommendation(
    soak: SoakProgress | None,
    runtime: RuntimeHealth | None,
    gates_passed: int,
    gates_total: int,
) -> str:
    if soak is None:
        return "unknown"
    if soak.result == "UNKNOWN":
        return "set_soak_t0"
    if soak.result == "PARTIAL":
        return "wait_for_24h_soak"
    if soak.result == "FAIL":
        return "investigate_soak_failure"
    # soak.result == "PASS" from here on
    if runtime is not None and not runtime_is_ok(runtime):
        return "investigate_runtime_health"
    if gates_total and gates_passed < gates_total:
        return "close_remaining_gates"
    return "request_ga_approval"


# ── top-level assembly ───────────────────────────────────────────────


def collect_status_board(
    *,
    t0_override: datetime | None = None,
    now: datetime | None = None,
    repo_root: Path | None = None,
) -> StatusBoard:
    current = now or _now_utc()
    root = repo_root or _repo_root()
    release_state = collect_release_state(root)
    runtime = collect_runtime_health()
    queue = collect_queue_state()
    signals = collect_signals()
    usage = collect_usage(now=current)
    soak = collect_soak_progress(
        t0_override=t0_override, now=current, repo_root=root,
        runtime_ok=runtime_is_ok(runtime),
    )
    ga_gates = collect_ga_gates(repo_root=root, soak=soak, runtime=runtime)
    return StatusBoard(
        generated_at=_iso(current),
        release_state=release_state,
        soak=soak,
        runtime_health=runtime,
        queue=queue,
        signals=signals,
        ga_gates=ga_gates,
        usage=usage,
    )


# ── renderers ────────────────────────────────────────────────────────


def _bar(percent: int, width: int = 20) -> str:
    percent = max(0, min(100, percent))
    filled = (percent * width) // 100
    return "[" + "#" * filled + "-" * (width - filled) + "]"


def _fmt_duration(seconds: int) -> str:
    h, rem = divmod(max(0, seconds), 3600)
    m, _ = divmod(rem, 60)
    return f"{h:02d}h {m:02d}m"


def render_plain(board: StatusBoard) -> str:
    lines: list[str] = []
    lines.append("Claude247 Watchdog Dashboard")
    lines.append(f"Generated: {board.generated_at}")
    lines.append("")
    rel = board.release_state
    lines.append("Release State")
    lines.append(
        f"- main: {(rel.main_sha or 'unknown')[:7]}"
        f" ({rel.latest_release or 'no tag'})"
    )
    lines.append(
        f"- claude247/v1: {(rel.implementation_branch_sha or 'unknown')[:7]}"
    )
    lines.append(
        f"- v1.0.0 tag: {'CREATED' if rel.ga_tag_exists else 'NOT CREATED'}"
    )
    lines.append(f"- GA status: {rel.ga_status}")
    lines.append("")
    soak = board.soak
    lines.append("Soak Progress")
    lines.append(f"- T0 dispatcher: {soak.t0 or 'unknown'}")
    lines.append(
        f"- elapsed: {_fmt_duration(soak.elapsed_seconds)} / "
        f"{_fmt_duration(soak.required_seconds)}"
    )
    lines.append(f"- progress: {_bar(soak.progress_percent)} {soak.progress_percent}%")
    lines.append(f"- result: {soak.result}")
    lines.append(f"- earliest full check: {soak.earliest_full_check or 'unknown'}")
    lines.append("")
    rh = board.runtime_health
    lines.append("Runtime Health")
    lines.append(f"- launchd: {rh.launchd_loaded}/{rh.launchd_expected} loaded")
    lines.append(f"- dispatcher: {rh.dispatcher}")
    lines.append(f"- dashboard: {rh.dashboard}")
    lines.append(f"- notifier: {rh.notifier}")
    lines.append(f"- doctor: {rh.doctor}")
    lines.append("")
    q = board.queue
    lines.append("Queue / Task State")
    lines.append(f"- repos enabled: {q.repos_enabled}")
    lines.append(f"- active tasks: {q.active_tasks}")
    lines.append(f"- stuck tasks: {q.stuck_tasks}")
    lines.append(f"- need approval: {q.need_approval}")
    lines.append(f"- orphan commands: {q.orphan_commands}")
    lines.append(f"- command queue pending: {q.pending_commands}")
    lines.append("")
    s = board.signals
    lines.append("Recent Signals")
    lines.append(f"- new critical errors (1h): {s.new_critical_errors}")
    lines.append(f"- known historical errors: {s.known_historical_errors}")
    lines.append(f"- alert storm: {'YES' if s.alert_storm else 'NO'}")
    lines.append(f"- budget: {'sane' if s.budget_sane else 'EXCEEDED'}")
    lines.append(f"- logs searchable: {'YES' if s.logs_searchable else 'NO'}")
    lines.append("")
    g = board.ga_gates
    lines.append("GA Gates")
    lines.append(f"- passed: {g.passed}/{g.total}")
    if g.blocked:
        lines.append("- blocked:")
        for i, item in enumerate(g.blocked, start=1):
            lines.append(f"  {i}. {item}")
    lines.append(f"- next action: {g.recommendation}")
    lines.append("")
    u = board.usage
    lines.append("Usage")
    lines.append(f"- runs total: {u.runs_total}")
    lines.append(f"- runs today: {u.runs_today}  (last hour: {u.runs_last_hour})")
    lines.append(f"- active workers: {u.active_workers}")
    lines.append(f"- est. cost today: ${u.estimated_cost_today_usd:.4f}")
    lines.append(f"- est. cost total: ${u.estimated_cost_total_usd:.4f}")
    if u.by_role:
        roles = ", ".join(f"{k}={v}" for k, v in sorted(u.by_role.items()))
        lines.append(f"- by role: {roles}")
    if u.by_auth_mode:
        modes = ", ".join(f"{k}={v}" for k, v in sorted(u.by_auth_mode.items()))
        lines.append(f"- by auth mode: {modes}")
    if u.note:
        lines.append(f"- note: {u.note}")
    return "\n".join(lines) + "\n"


def render_markdown(board: StatusBoard) -> str:
    rel = board.release_state
    soak = board.soak
    rh = board.runtime_health
    q = board.queue
    s = board.signals
    g = board.ga_gates
    u = board.usage

    soak_status = soak.result
    runtime_status = "HEALTHY" if runtime_is_ok(rh) else "DEGRADED"
    queue_status = (
        "CLEAN" if (q.active_tasks == 0 and q.stuck_tasks == 0
                    and q.orphan_commands == 0)
        else "ACTIVE"
    )

    md: list[str] = []
    md.append("# Claude247 Watchdog Dashboard")
    md.append("")
    md.append(f"**Generated:** `{board.generated_at}`")
    md.append("")
    md.append("> This dashboard is read-only. A non-`PASS` soak means **DO NOT**")
    md.append("> tag `v1.0.0`. Re-run after the elapsed time crosses 24h.")
    md.append("")
    md.append("## Summary")
    md.append("")
    md.append("| Area | Status |")
    md.append("|---|---|")
    md.append(f"| GA | {rel.ga_status} |")
    md.append(f"| Soak | {soak_status} |")
    md.append(f"| Runtime | {runtime_status} |")
    md.append(f"| Queue | {queue_status} |")
    md.append(f"| Gates | {g.passed}/{g.total} passed |")
    md.append(f"| Next action | `{g.recommendation}` |")
    md.append("")
    md.append("## Release State")
    md.append("")
    md.append(f"- `main`: `{rel.main_sha or 'unknown'}` ({rel.latest_release or 'no tag'})")
    md.append(f"- `claude247/v1`: `{rel.implementation_branch_sha or 'unknown'}`")
    md.append(f"- `v1.0.0` tag exists: **{'YES' if rel.ga_tag_exists else 'NO'}**")
    md.append("")
    md.append("## Soak Progress")
    md.append("")
    md.append(f"- T0: `{soak.t0 or 'unknown'}`")
    md.append(
        f"- elapsed: {_fmt_duration(soak.elapsed_seconds)} of "
        f"{_fmt_duration(soak.required_seconds)} required"
    )
    md.append(f"- progress: `{_bar(soak.progress_percent)} {soak.progress_percent}%`")
    md.append(f"- result: **{soak.result}**")
    md.append(f"- earliest full check: `{soak.earliest_full_check or 'unknown'}`")
    md.append("")
    md.append("## Runtime Health")
    md.append("")
    md.append("| Probe | Result |")
    md.append("|---|---|")
    md.append(f"| launchd | {rh.launchd_loaded}/{rh.launchd_expected} loaded |")
    md.append(f"| dispatcher | {rh.dispatcher} |")
    md.append(f"| dashboard | {rh.dashboard} |")
    md.append(f"| notifier | {rh.notifier} |")
    md.append(f"| doctor | {rh.doctor} |")
    md.append("")
    md.append("## Queue and Tasks")
    md.append("")
    md.append("| Metric | Count |")
    md.append("|---|---|")
    md.append(f"| repos enabled | {q.repos_enabled} |")
    md.append(f"| active tasks | {q.active_tasks} |")
    md.append(f"| stuck tasks | {q.stuck_tasks} |")
    md.append(f"| need approval | {q.need_approval} |")
    md.append(f"| orphan commands | {q.orphan_commands} |")
    md.append(f"| pending commands | {q.pending_commands} |")
    md.append("")
    md.append("## Recent Signals")
    md.append("")
    md.append(f"- new critical errors (last hour): **{s.new_critical_errors}**")
    md.append(f"- known historical errors: {s.known_historical_errors}")
    md.append(f"- alert storm: **{'YES' if s.alert_storm else 'NO'}**")
    md.append(f"- budget: {'sane' if s.budget_sane else 'EXCEEDED'}")
    md.append(f"- logs searchable: {'YES' if s.logs_searchable else 'NO'}")
    md.append("")
    md.append("## GA Gate Progress")
    md.append("")
    md.append(f"- passed: **{g.passed}/{g.total}**")
    if g.blocked:
        md.append("- blocked:")
        for item in g.blocked:
            md.append(f"  - {item}")
    md.append(f"- recommendation: `{g.recommendation}`")
    md.append("")
    md.append("## Usage")
    md.append("")
    md.append("| Metric | Value |")
    md.append("|---|---|")
    md.append(f"| runs total | {u.runs_total} |")
    md.append(f"| runs today | {u.runs_today} |")
    md.append(f"| runs (last hour) | {u.runs_last_hour} |")
    md.append(f"| active workers | {u.active_workers} |")
    md.append(f"| est. cost today | ${u.estimated_cost_today_usd:.4f} |")
    md.append(f"| est. cost total | ${u.estimated_cost_total_usd:.4f} |")
    if u.by_role:
        md.append(f"| by role | {', '.join(f'{k}={v}' for k, v in sorted(u.by_role.items()))} |")
    if u.by_auth_mode:
        md.append(f"| by auth mode | {', '.join(f'{k}={v}' for k, v in sorted(u.by_auth_mode.items()))} |")
    if u.note:
        md.append("")
        md.append(f"> {u.note}")
    md.append("")
    md.append("## Commands to Run Next")
    md.append("")
    md.append("```bash")
    md.append("claude247 status-board --plain")
    md.append("claude247 doctor --json")
    md.append("scripts/doctor_launchd.sh || true")
    md.append("```")
    md.append("")
    md.append("---")
    md.append("")
    md.append("**Final reminder:** this dashboard is *not* a 24h soak PASS by")
    md.append("itself. Do not tag `v1.0.0` until soak result is `PASS` *and*")
    md.append("all GA_BLOCKER gates are closed.")
    md.append("")
    return "\n".join(md)


def write_markdown(board: StatusBoard, path: Path) -> Path:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(render_markdown(board), encoding="utf-8")
    return target


__all__ = [
    "SOAK_REQUIRED_SECONDS",
    "ORPHAN_COMMAND_SECONDS",
    "NEW_ERROR_WINDOW_SECONDS",
    "LAUNCHD_SERVICES",
    "ReleaseState",
    "SoakProgress",
    "RuntimeHealth",
    "QueueState",
    "Signals",
    "GaGates",
    "UsageStats",
    "StatusBoard",
    "collect_release_state",
    "collect_soak_progress",
    "collect_runtime_health",
    "collect_queue_state",
    "collect_signals",
    "collect_ga_gates",
    "collect_usage",
    "collect_status_board",
    "discover_soak_t0",
    "parse_soak_t0",
    "parse_ga_blockers",
    "render_plain",
    "render_markdown",
    "write_markdown",
    "runtime_is_ok",
]
