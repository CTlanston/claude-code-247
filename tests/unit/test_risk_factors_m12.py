from __future__ import annotations

from orchestrator.risk_score import DiffStats, compute_risk
from validator.judge_contract import normalize_response


def _v(name: str, verdict: str):
    return normalize_response(name, {"verdict": verdict, "confidence": 0.9,
                                      "summary": "", "blocking_issues": [],
                                      "non_blocking_issues": [], "evidence_gaps": [],
                                      "recommended_next_action": ""})


def test_database_migration_by_path() -> None:
    d = DiffStats(files=["src/db/migrations/0042_add_users.py",
                          "tests/test_users.py"],
                   insertions=30, deletions=0)
    r = compute_risk(d, allowed_paths=["**"], forbidden_paths=[],
                    validators=[_v("g", "PASS"), _v("o", "PASS")])
    names = {f.name for f in r.triggered}
    assert "database_migration" in names
    factor = next(f for f in r.triggered if f.name == "database_migration")
    assert "0042" in factor.reason


def test_database_migration_by_sql_content() -> None:
    d = DiffStats(files=["scripts/seed.py"], insertions=20, deletions=0)
    diff_text = (
        "+def seed():\n"
        "+    cur.execute(\"CREATE TABLE users (id INT PRIMARY KEY)\")\n"
    )
    r = compute_risk(d, allowed_paths=["**"], forbidden_paths=[],
                    validators=[_v("g", "PASS"), _v("o", "PASS")],
                    diff_content=diff_text)
    assert any(f.name == "database_migration" for f in r.triggered)


def test_low_test_coverage_triggered_below_threshold() -> None:
    d = DiffStats(files=["src/a.py", "tests/test_a.py"], insertions=10, deletions=0)
    r = compute_risk(d, allowed_paths=["**"], forbidden_paths=[],
                    validators=[_v("g", "PASS"), _v("o", "PASS")],
                    coverage_pct=42.0)
    assert any(f.name == "low_test_coverage" for f in r.triggered)


def test_low_test_coverage_not_triggered_above_threshold() -> None:
    d = DiffStats(files=["src/a.py", "tests/test_a.py"], insertions=10, deletions=0)
    r = compute_risk(d, allowed_paths=["**"], forbidden_paths=[],
                    validators=[_v("g", "PASS"), _v("o", "PASS")],
                    coverage_pct=92.0)
    assert not any(f.name == "low_test_coverage" for f in r.triggered)


def test_low_test_coverage_inactive_when_none() -> None:
    d = DiffStats(files=["src/a.py", "tests/test_a.py"], insertions=10, deletions=0)
    r = compute_risk(d, allowed_paths=["**"], forbidden_paths=[],
                    validators=[_v("g", "PASS"), _v("o", "PASS")],
                    coverage_pct=None)
    # Factor present (in factors), not triggered
    by_name = {f.name: f for f in r.factors}
    assert by_name["low_test_coverage"].triggered is False
