"""CostPolicy tests — proves cheap mode never allows paid API."""
from __future__ import annotations

from pathlib import Path

from autodev.cost_policy import CostPolicy
from autodev.project_state import ProjectState


def _make(mode: str, **kw) -> CostPolicy:
    base = dict(
        mode=mode,
        allowed_sdk=True,
        daily_cap=100.0,
        premium_guardian=True,
        today_spend=0.0,
        audit_log=Path("/tmp/_autodev_test_audit.md"),
    )
    base.update(kw)
    return CostPolicy(**base)


def test_cheap_mode_denies_anthropic_sdk():
    p = _make("cheap")
    d = p.is_executor_allowed("anthropic_sdk")
    assert not d.allowed
    assert "cheap" in d.reason.lower()


def test_balanced_mode_denies_sdk_when_config_forbids():
    p = _make("balanced", allowed_sdk=False)
    d = p.is_executor_allowed("anthropic_sdk")
    assert not d.allowed


def test_balanced_mode_allows_sdk_when_permitted_and_under_cap():
    p = _make("balanced", allowed_sdk=True, daily_cap=10.0, today_spend=1.0)
    d = p.is_executor_allowed("anthropic_sdk")
    assert d.allowed


def test_daily_cap_zero_denies_even_in_premium():
    p = _make("premium", daily_cap=0.0)
    d = p.is_executor_allowed("guardian_premium")
    assert not d.allowed
    assert "daily_usd_cap" in d.reason.lower()


def test_today_spend_at_or_over_cap_denies():
    p = _make("premium", daily_cap=5.0, today_spend=5.0)
    d = p.is_executor_allowed("guardian_premium")
    assert not d.allowed


def test_cli_always_allowed_in_every_mode():
    for mode in ("cheap", "balanced", "premium"):
        d = _make(mode).is_executor_allowed("claude_code_cli")
        assert d.allowed, f"CLI denied in {mode}"


def test_unknown_executor_denied():
    d = _make("premium").is_executor_allowed("unknown_thing")
    assert not d.allowed


def test_from_state_reads_cost_mode():
    s = ProjectState()
    s["cost_mode"] = "balanced"
    s["api_spend_today_usd"] = 0
    p = CostPolicy.from_state(s)
    assert p.mode == "balanced"


def test_denied_call_writes_audit(tmp_path: Path):
    audit = tmp_path / "decisions.md"
    p = CostPolicy(
        mode="cheap", allowed_sdk=False, daily_cap=0.0,
        premium_guardian=False, today_spend=0.0, audit_log=audit,
    )
    p.is_executor_allowed("anthropic_sdk")
    text = audit.read_text()
    assert "COST-DENY" in text
    assert "anthropic_sdk" in text
