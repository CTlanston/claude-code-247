"""M22b — soak progress math and recommendation routing."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from gateway import status_board
from gateway.status_board import (
    GaGates,
    RuntimeHealth,
    SoakProgress,
    collect_ga_gates,
    collect_soak_progress,
    parse_soak_t0,
    runtime_is_ok,
)


_T0 = datetime(2026, 5, 24, 21, 46, 0, tzinfo=timezone.utc)


def _now(delta_h: float) -> datetime:
    return _T0 + timedelta(hours=delta_h)


def _healthy_runtime() -> RuntimeHealth:
    return RuntimeHealth(
        launchd_loaded=4, launchd_expected=4,
        dispatcher="healthy", dashboard="healthy",
        notifier="healthy", doctor="ok",
    )


def _degraded_runtime() -> RuntimeHealth:
    return RuntimeHealth(
        launchd_loaded=3, launchd_expected=4,
        dispatcher="stale", dashboard="healthy",
        notifier="healthy", doctor="ok",
    )


def test_t0_unknown_yields_unknown_result(tmp_path) -> None:
    # Force discovery to look at an empty dir so it can't find the
    # repo's real M20_SOAK_RESULT.md.
    s = collect_soak_progress(
        t0_override=None, now=_now(1), repo_root=tmp_path,
    )
    assert s.result == "UNKNOWN"
    assert s.elapsed_seconds == 0
    assert s.progress_percent == 0
    assert s.t0 is None


def test_partial_at_one_hour_in() -> None:
    s = collect_soak_progress(t0_override=_T0, now=_now(1), runtime_ok=True)
    assert s.result == "PARTIAL"
    assert 4 <= s.progress_percent <= 5  # 1h of 24h = ~4.16%
    assert s.elapsed_seconds == 3600


def test_pass_only_when_24h_elapsed_AND_runtime_ok() -> None:
    s = collect_soak_progress(t0_override=_T0, now=_now(25), runtime_ok=True)
    assert s.result == "PASS"
    assert s.progress_percent == 100
    assert s.elapsed_seconds >= 24 * 3600


def test_fail_when_24h_elapsed_BUT_runtime_degraded() -> None:
    s = collect_soak_progress(t0_override=_T0, now=_now(25), runtime_ok=False)
    assert s.result == "FAIL"


def test_progress_capped_at_100() -> None:
    s = collect_soak_progress(t0_override=_T0, now=_now(100), runtime_ok=True)
    assert s.progress_percent == 100


def test_progress_never_negative_on_clock_skew() -> None:
    """Wall clock can go backwards (NTP correction). We should not panic."""
    s = collect_soak_progress(t0_override=_T0, now=_T0 - timedelta(minutes=5))
    assert s.elapsed_seconds == 0
    assert s.progress_percent == 0


def test_earliest_full_check_is_t0_plus_24h() -> None:
    s = collect_soak_progress(t0_override=_T0, now=_now(1))
    assert s.earliest_full_check == "2026-05-25T21:46:00Z"


def test_parse_t0_from_soak_result_markdown() -> None:
    text = (
        "| Dispatcher effective T0 (clean run) | 2026-05-24 ~21:46 UTC |\n"
        "| Other row | 2026-05-24 22:00 UTC |\n"
    )
    dt = parse_soak_t0(text)
    assert dt is not None
    assert dt == datetime(2026, 5, 24, 21, 46, tzinfo=timezone.utc)


def test_parse_t0_from_m22_style_backticked_iso() -> None:
    text = (
        "| M20-P3 dispatcher reload after E2E iteration | `2026-05-24T21:46Z` |\n"
    )
    dt = parse_soak_t0(text)
    assert dt == datetime(2026, 5, 24, 21, 46, tzinfo=timezone.utc)


def test_parse_t0_returns_none_when_absent() -> None:
    assert parse_soak_t0("no soak info here") is None


def test_runtime_is_ok_requires_all_four() -> None:
    assert runtime_is_ok(_healthy_runtime()) is True
    assert runtime_is_ok(_degraded_runtime()) is False


def test_recommendation_unknown_when_no_t0() -> None:
    soak = SoakProgress(
        t0=None, elapsed_seconds=0, required_seconds=86400,
        progress_percent=0, result="UNKNOWN", earliest_full_check=None,
    )
    g = collect_ga_gates(soak=soak, runtime=_healthy_runtime(),
                          repo_root=None)
    assert g.recommendation == "set_soak_t0"


def test_recommendation_wait_when_partial() -> None:
    soak = SoakProgress(
        t0="2026-05-24T21:46:00Z", elapsed_seconds=3600,
        required_seconds=86400, progress_percent=4,
        result="PARTIAL", earliest_full_check="2026-05-25T21:46:00Z",
    )
    g = collect_ga_gates(soak=soak, runtime=_healthy_runtime())
    assert g.recommendation == "wait_for_24h_soak"


def test_recommendation_investigate_when_fail() -> None:
    soak = SoakProgress(
        t0="2026-05-24T21:46:00Z", elapsed_seconds=24 * 3600,
        required_seconds=86400, progress_percent=100,
        result="FAIL", earliest_full_check="2026-05-25T21:46:00Z",
    )
    g = collect_ga_gates(soak=soak, runtime=_degraded_runtime())
    assert g.recommendation == "investigate_soak_failure"


def test_recommendation_request_approval_when_pass_and_all_gates_closed(
    monkeypatch, tmp_path,
) -> None:
    # Fake a GA_GATE.md with all rows ✅ to simulate a fully green gate.
    gate = tmp_path / "GA_GATE.md"
    gate.write_text(
        "## GA_BLOCKER\n"
        "\n"
        "| # | Criterion | Status | Evidence |\n"
        "|---|---|---|---|\n"
        "| 1 | gate one | ✅ done | x |\n"
        "| 2 | gate two | ✅ done | y |\n",
        encoding="utf-8",
    )
    soak = SoakProgress(
        t0="2026-05-24T21:46:00Z", elapsed_seconds=25 * 3600,
        required_seconds=86400, progress_percent=100,
        result="PASS", earliest_full_check="2026-05-25T21:46:00Z",
    )
    g = collect_ga_gates(
        soak=soak, runtime=_healthy_runtime(), repo_root=tmp_path,
    )
    assert (g.passed, g.total) == (2, 2)
    assert g.recommendation == "request_ga_approval"


def test_recommendation_close_gates_when_pass_but_blockers_remain(tmp_path) -> None:
    gate = tmp_path / "GA_GATE.md"
    gate.write_text(
        "## GA_BLOCKER\n"
        "\n"
        "| # | Criterion | Status | Evidence |\n"
        "|---|---|---|---|\n"
        "| 1 | gate one | ✅ done | x |\n"
        "| 2 | gate two | ⏳ partial | y |\n",
        encoding="utf-8",
    )
    soak = SoakProgress(
        t0="2026-05-24T21:46:00Z", elapsed_seconds=25 * 3600,
        required_seconds=86400, progress_percent=100,
        result="PASS", earliest_full_check="2026-05-25T21:46:00Z",
    )
    g = collect_ga_gates(
        soak=soak, runtime=_healthy_runtime(), repo_root=tmp_path,
    )
    assert g.recommendation == "close_remaining_gates"
