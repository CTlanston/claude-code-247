from __future__ import annotations

from orchestrator.risk_score import DiffStats, compute_risk
from validator.judge_contract import normalize_response


def _v(name: str, verdict: str):
    return normalize_response(name, {"verdict": verdict, "confidence": 0.9,
                                      "summary": "", "blocking_issues": [],
                                      "non_blocking_issues": [], "evidence_gaps": [],
                                      "recommended_next_action": ""})


def test_parses_numstat() -> None:
    text = "10\t2\tsrc/a.py\n5\t0\ttests/test_a.py\n-\t-\tdocs/img.png\n"
    d = DiffStats.from_git_numstat(text)
    assert d.files == ["src/a.py", "tests/test_a.py", "docs/img.png"]
    assert d.insertions == 15
    assert d.deletions == 2


def test_low_risk_tiny_change_passes() -> None:
    d = DiffStats(files=["src/x.py", "tests/test_x.py"], insertions=15, deletions=2)
    r = compute_risk(d, allowed_paths=["**"], forbidden_paths=[".env"],
                    validators=[_v("g", "PASS"), _v("o", "PASS")])
    assert r.level == "low"
    assert r.score <= 30


def test_forbidden_path_touch_is_top_severity() -> None:
    d = DiffStats(files=[".env", "src/x.py"], insertions=2, deletions=0)
    r = compute_risk(d, allowed_paths=["**"], forbidden_paths=[".env"],
                    validators=[_v("g", "PASS"), _v("o", "PASS")])
    assert r.score >= 100
    assert r.level == "high"
    assert any(f.name == "forbidden_path_touch" for f in r.triggered)


def test_workflow_change_pushes_to_medium_or_high() -> None:
    d = DiffStats(files=[".github/workflows/ci.yml"], insertions=10, deletions=2)
    r = compute_risk(d, allowed_paths=["**"], forbidden_paths=[],
                    validators=[_v("g", "PASS"), _v("o", "PASS")])
    assert r.level in ("medium", "high")
    assert any(f.name == "workflow_change" for f in r.triggered)


def test_dependency_change_flagged() -> None:
    d = DiffStats(files=["pyproject.toml"], insertions=2, deletions=1)
    r = compute_risk(d, allowed_paths=["**"], forbidden_paths=[],
                    validators=[_v("g", "PASS"), _v("o", "PASS")])
    assert any(f.name == "dependency_change" for f in r.triggered)


def test_code_change_without_test_flagged() -> None:
    d = DiffStats(files=["src/feature.py"], insertions=40, deletions=0)
    r = compute_risk(d, allowed_paths=["**"], forbidden_paths=[],
                    validators=[_v("g", "PASS"), _v("o", "PASS")])
    assert any(f.name == "code_change_without_test" for f in r.triggered)


def test_validator_disagreement_flagged() -> None:
    d = DiffStats(files=["src/x.py", "tests/test_x.py"], insertions=10, deletions=0)
    r = compute_risk(d, allowed_paths=["**"], forbidden_paths=[],
                    validators=[_v("g", "PASS"), _v("o", "FAIL")])
    assert any(f.name == "validator_disagreement" for f in r.triggered)


def test_ci_failure_flagged() -> None:
    d = DiffStats(files=["src/x.py", "tests/test_x.py"], insertions=10, deletions=0)
    r = compute_risk(d, allowed_paths=["**"], forbidden_paths=[],
                    validators=[_v("g", "PASS"), _v("o", "PASS")],
                    ci_passed=False)
    assert any(f.name == "ci_failure" for f in r.triggered)


def test_large_change_lands_in_medium_or_high() -> None:
    files = [f"src/file{i}.py" for i in range(20)] + [f"tests/test_{i}.py" for i in range(20)]
    d = DiffStats(files=files, insertions=600, deletions=100)
    r = compute_risk(d, allowed_paths=["**"], forbidden_paths=[],
                    validators=[_v("g", "PASS"), _v("o", "PASS")])
    assert r.level in ("medium", "high")


def test_score_clamped_to_100() -> None:
    files = [".env", ".github/workflows/x.yml", "pyproject.toml",
             "orchestrator/main.py", "runner/worker.py", "validator/openai_judge.py"]
    d = DiffStats(files=files, insertions=1500, deletions=400)
    r = compute_risk(d, allowed_paths=["**"], forbidden_paths=[".env"],
                    validators=[_v("g", "PASS"), _v("o", "FAIL")])
    assert r.score == 100
