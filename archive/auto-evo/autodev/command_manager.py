"""CommandManager — parse `commands/inbox.md`, apply, archive.

Supported commands (one per line, starting with /):

    /status
    /report
    /pause
    /resume
    /new-task P<n> <title> :: <details>
    /set-mode cheap|balanced|premium
    /allow-live true|false
    /allow-autostart true|false

Idempotency: each command line is hashed; commands already in
`commands/processed.md` are skipped.
"""
from __future__ import annotations

import hashlib
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

from .project_state import ProjectState


def _project_root() -> Path:
    return Path(__file__).resolve().parent.parent


def inbox_path() -> Path:
    return _project_root() / "commands" / "inbox.md"


def processed_path() -> Path:
    return _project_root() / "commands" / "processed.md"


def backlog_path() -> Path:
    return _project_root() / "tasks" / "backlog.md"


_CMD_RE = re.compile(r"^\s*(/[a-z-]+)(?:\s+(.*))?$")
_NEW_TASK_RE = re.compile(r"^(P\d+)\s+([^:]+?)\s*::\s*(.+)$")


@dataclass
class CommandResult:
    raw: str
    name: str
    args: str
    outcome: str           # "applied" | "skipped" | "rejected" | "queued"
    detail: str = ""

    def archive_line(self) -> str:
        ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        return f"{ts}  {self.raw:<60s}  → {self.outcome}  {self.detail}".rstrip()


class CommandManager:
    """Parse the inbox, apply effects to state / backlog, archive."""

    def __init__(self, state: ProjectState):
        self.state = state

    # ----- entry -----------------------------------------------------------

    def process_inbox(self) -> list[CommandResult]:
        text = inbox_path().read_text() if inbox_path().exists() else ""
        processed_hashes = self._processed_hashes()
        results: list[CommandResult] = []
        in_fence = False
        for line in text.splitlines():
            stripped = line.strip()
            # Skip everything inside ``` fenced code blocks — the inbox
            # template documents the supported commands inside a fence;
            # we must NOT treat docs as live commands.
            if stripped.startswith("```"):
                in_fence = not in_fence
                continue
            if in_fence:
                continue
            if not stripped or not stripped.startswith("/"):
                continue
            h = self._line_hash(stripped)
            if h in processed_hashes:
                continue
            r = self._apply_one(stripped)
            results.append(r)
        if results:
            self._archive(results)
        return results

    # ----- core dispatcher -------------------------------------------------

    def _apply_one(self, line: str) -> CommandResult:
        m = _CMD_RE.match(line)
        if not m:
            return CommandResult(line, "", "", "rejected", "malformed")
        name, args = m.group(1), (m.group(2) or "").strip()
        handler: Optional[Callable[[str], CommandResult]] = {
            "/status": self._cmd_status,
            "/report": self._cmd_report,
            "/pause": self._cmd_pause,
            "/resume": self._cmd_resume,
            "/new-task": self._cmd_new_task,
            "/set-mode": self._cmd_set_mode,
            "/allow-live": self._cmd_allow_live,
            "/allow-autostart": self._cmd_allow_autostart,
        }.get(name)
        if handler is None:
            return CommandResult(line, name, args, "rejected", "unknown command")
        try:
            return handler(args)._replace_raw(line)
        except Exception as e:  # noqa: BLE001
            return CommandResult(line, name, args, "rejected", f"error: {e}")

    # ----- individual command handlers ------------------------------------
    # Each returns a CommandResult whose .raw will be re-assigned by _apply_one.

    def _cmd_status(self, _args: str) -> CommandResult:
        return CommandResult("", "/status", "", "applied", "status will be emitted by supervisor")

    def _cmd_report(self, _args: str) -> CommandResult:
        # The supervisor checks for a /report and forces REPORT_ONLY.
        return CommandResult("", "/report", "", "queued", "report-only cycle requested")

    def _cmd_pause(self, _args: str) -> CommandResult:
        self.state["paused"] = True
        return CommandResult("", "/pause", "", "applied", "paused=true")

    def _cmd_resume(self, _args: str) -> CommandResult:
        self.state["paused"] = False
        return CommandResult("", "/resume", "", "applied", "paused=false")

    def _cmd_new_task(self, args: str) -> CommandResult:
        m = _NEW_TASK_RE.match(args)
        if not m:
            return CommandResult("", "/new-task", args, "rejected", "expected: P<n> <title> :: <details>")
        prio, title, details = m.group(1), m.group(2).strip(), m.group(3).strip()
        new_id = self._next_task_id()
        self._append_backlog(prio, new_id, title, details)
        return CommandResult("", "/new-task", args, "applied", f"added {new_id} at {prio}")

    def _cmd_set_mode(self, args: str) -> CommandResult:
        mode = args.strip().lower()
        if mode not in ("cheap", "balanced", "premium"):
            return CommandResult("", "/set-mode", args, "rejected", "must be cheap|balanced|premium")
        self.state["mode"] = mode
        self.state["cost_mode"] = mode
        # NOTE: api_spend_allowed is intentionally NOT set here. CostPolicy is
        # the single source of truth; it reads HUMAN_CONFIG.md +
        # mode + daily_cap and decides per-call. Treating "mode=premium" as
        # auto-permission would skip that gate.
        return CommandResult("", "/set-mode", args, "applied", f"mode={mode}")

    def _cmd_allow_live(self, args: str) -> CommandResult:
        v = args.strip().lower()
        if v not in ("true", "false"):
            return CommandResult("", "/allow-live", args, "rejected", "must be true|false")
        self.state["live_allowed"] = (v == "true")
        return CommandResult("", "/allow-live", args, "applied", f"live_allowed={v}")

    def _cmd_allow_autostart(self, args: str) -> CommandResult:
        v = args.strip().lower()
        if v not in ("true", "false"):
            return CommandResult("", "/allow-autostart", args, "rejected", "must be true|false")
        self.state["autostart_allowed"] = (v == "true")
        return CommandResult("", "/allow-autostart", args, "applied", f"autostart_allowed={v}")

    # ----- helpers ---------------------------------------------------------

    def _next_task_id(self) -> str:
        """Scan backlog.md for max TASK-NNN and return next id."""
        b = backlog_path()
        if not b.exists():
            return "TASK-001"
        nums = [int(m.group(1)) for m in re.finditer(r"\bTASK-(\d+)\b", b.read_text())]
        return f"TASK-{(max(nums) + 1 if nums else 1):03d}"

    def _append_backlog(self, prio: str, task_id: str, title: str, details: str) -> None:
        b = backlog_path()
        b.parent.mkdir(parents=True, exist_ok=True)
        existing = b.read_text() if b.exists() else "# Backlog\n\n"
        line = f"\n- [ ] {task_id}: {title} :: {details}"
        header = f"\n## {prio}\n"
        # If the priority header exists, append under it; else append a new section.
        if header in existing or existing.endswith(f"## {prio}\n"):
            # Re-emit, splice after the priority header. Simple line-based pass.
            new_lines: list[str] = []
            inserted = False
            for ln in existing.splitlines():
                new_lines.append(ln)
                if not inserted and ln.strip() == f"## {prio}":
                    new_lines.append(line.lstrip())
                    inserted = True
            if not inserted:
                new_lines.append(line)
            b.write_text("\n".join(new_lines).rstrip() + "\n")
        else:
            b.write_text(existing.rstrip() + "\n\n" + f"## {prio}\n" + line + "\n")

    def _processed_hashes(self) -> set[str]:
        p = processed_path()
        if not p.exists():
            return set()
        hashes: set[str] = set()
        for line in p.read_text().splitlines():
            # We embed `:hash=<h>` as a trailing marker.
            m = re.search(r":hash=([0-9a-f]{12})", line)
            if m:
                hashes.add(m.group(1))
        return hashes

    @staticmethod
    def _line_hash(line: str) -> str:
        return hashlib.sha256(line.encode("utf-8")).hexdigest()[:12]

    def _archive(self, results: list[CommandResult]) -> None:
        p = processed_path()
        p.parent.mkdir(parents=True, exist_ok=True)
        existing = p.read_text() if p.exists() else "# Processed commands\n\nLatest at top.\n\n"
        new_block: list[str] = []
        for r in results:
            h = self._line_hash(r.raw) if r.raw else self._line_hash(r.name + r.args)
            new_block.append(f"{r.archive_line()}  :hash={h}")
        merged = existing.rstrip() + "\n\n" + "\n".join(new_block) + "\n"
        p.write_text(merged)


# Tiny helper so handlers can replace .raw without dataclasses replace().
def _result_replace_raw(self: CommandResult, line: str) -> CommandResult:
    self.raw = line
    return self
CommandResult._replace_raw = _result_replace_raw  # type: ignore[attr-defined]
