"""M22b — read-only watchdog dashboard.

Covers CLI registration, plain rendering, markdown rendering, GA gate
parsing, and the "read-only" contract (no DB or system_state mutation).
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from click.testing import CliRunner

from gateway import status_board
from gateway.cli import cli
from memory.db import init_db, open_db


_FIXED_NOW = datetime(2026, 5, 25, 21, 46, 0, tzinfo=timezone.utc)
_T0 = datetime(2026, 5, 24, 21, 46, 0, tzinfo=timezone.utc)


def _patch_live_probes(monkeypatch) -> None:
    """Replace every live probe with a deterministic stub.

    The real watchdog talks to launchctl / HTTP /healthz / the host
    doctor — none of which exist in CI. Tests pin each to a known value
    so we can assert on the rendered output.
    """
    monkeypatch.setattr(status_board, "_launchd_loaded_count", lambda: 4)
    monkeypatch.setattr(status_board, "_dispatcher_health", lambda: "healthy")
    monkeypatch.setattr(status_board, "_dashboard_health", lambda timeout=2.0: "healthy")
    monkeypatch.setattr(status_board, "_notifier_health", lambda: "healthy")
    monkeypatch.setattr(status_board, "_doctor_health", lambda: "ok")
    monkeypatch.setattr(status_board, "_now_utc", lambda: _FIXED_NOW)


def test_cli_registers_status_board_and_watchdog() -> None:
    assert "status-board" in cli.commands
    assert "watchdog" in cli.commands


def test_plain_default_renders_expected_sections(monkeypatch) -> None:
    _patch_live_probes(monkeypatch)
    init_db()
    r = CliRunner().invoke(cli, ["status-board", "--plain", "--t0", "2026-05-24T21:46Z"])
    assert r.exit_code == 0, r.output
    for required in (
        "Claude247 Watchdog Dashboard",
        "Release State",
        "Soak Progress",
        "Runtime Health",
        "Queue / Task State",
        "Recent Signals",
        "GA Gates",
    ):
        assert required in r.output, f"missing {required!r} in plain output"


def test_default_invocation_emits_plain(monkeypatch) -> None:
    """No flags → same as --plain (interactive default)."""
    _patch_live_probes(monkeypatch)
    init_db()
    r = CliRunner().invoke(cli, ["status-board", "--t0", "2026-05-24T21:46Z"])
    assert r.exit_code == 0, r.output
    assert "Claude247 Watchdog Dashboard" in r.output


def test_write_md_creates_markdown(monkeypatch, tmp_path: Path) -> None:
    _patch_live_probes(monkeypatch)
    init_db()
    out = tmp_path / "WATCHDOG.md"
    r = CliRunner().invoke(
        cli,
        ["status-board", "--plain", "--t0", "2026-05-24T21:46Z", "--write-md", str(out)],
    )
    assert r.exit_code == 0, r.output
    assert out.is_file()
    body = out.read_text(encoding="utf-8")
    for section in (
        "# Claude247 Watchdog Dashboard",
        "## Summary",
        "## Soak Progress",
        "## Runtime Health",
        "## Queue and Tasks",
        "## GA Gate Progress",
    ):
        assert section in body, f"markdown missing {section!r}"


def test_watchdog_alias_runs_same_command(monkeypatch) -> None:
    _patch_live_probes(monkeypatch)
    init_db()
    a = CliRunner().invoke(cli, ["watchdog", "--plain", "--t0", "2026-05-24T21:46Z"])
    b = CliRunner().invoke(cli, ["status-board", "--plain", "--t0", "2026-05-24T21:46Z"])
    assert a.exit_code == 0 and b.exit_code == 0
    assert a.output == b.output


def test_read_only_does_not_mutate_db(monkeypatch) -> None:
    """The watchdog must never INSERT/UPDATE/DELETE — the soak depends
    on it. Compare counts before vs after a CLI invocation."""
    _patch_live_probes(monkeypatch)
    init_db()
    counts_before: dict[str, int] = {}
    counted_tables = ("tasks", "commands", "system_state", "logs", "alerts")
    with open_db() as conn:
        for t in counted_tables:
            counts_before[t] = conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
    r = CliRunner().invoke(cli, ["status-board", "--plain", "--t0", "2026-05-24T21:46Z"])
    assert r.exit_code == 0
    with open_db() as conn:
        for t in counted_tables:
            after = conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
            assert after == counts_before[t], f"{t} mutated: {counts_before[t]} → {after}"


def test_bad_t0_is_a_user_error(monkeypatch) -> None:
    _patch_live_probes(monkeypatch)
    init_db()
    r = CliRunner().invoke(cli, ["status-board", "--plain", "--t0", "not-a-date"])
    assert r.exit_code != 0
    assert "iso" in r.output.lower() or "t0" in r.output.lower()


def test_parse_ga_blockers_counts_emoji_status() -> None:
    md = (
        "## GA_BLOCKER — must be true before tagging\n"
        "\n"
        "| # | Criterion | Status | Evidence |\n"
        "|---|---|---|---|\n"
        "| 1 | 24h soak PASS — needs wallclock | ⏳ **PARTIAL** | x |\n"
        "| 2 | `pytest -q` full PASS | ✅ 526 passing | latest |\n"
        "| 3 | docs current | ⏳ partial | later |\n"
        "\n"
        "## GA_REQUIRED — quality bars\n"
        "\n"
        "| Criterion | Status |\n"
        "|---|---|\n"
        "| something else | ✅ |\n"
    )
    passed, total, blocked = status_board.parse_ga_blockers(md)
    assert (passed, total) == (1, 3)
    assert any("soak" in b.lower() for b in blocked)
    assert any("docs" in b.lower() for b in blocked)
    # The GA_REQUIRED section must NOT be counted toward GA_BLOCKER totals.
    assert "something else" not in " ".join(blocked).lower()


def test_render_markdown_includes_summary_table(monkeypatch) -> None:
    _patch_live_probes(monkeypatch)
    init_db()
    board = status_board.collect_status_board(t0_override=_T0)
    body = status_board.render_markdown(board)
    assert "| Area | Status |" in body
    assert "| GA |" in body
    assert "| Soak |" in body
    assert "| Runtime |" in body
    assert "| Queue |" in body
    assert "| Gates |" in body
