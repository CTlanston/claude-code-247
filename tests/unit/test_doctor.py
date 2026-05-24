from __future__ import annotations

import json

from gateway.doctor import (
    Check,
    check_db_init,
    check_python,
    check_repos_yaml,
    check_state_dir,
    check_validator_keys,
    run_doctor,
    to_json,
    to_plain,
)


def test_check_python_passes_on_311_plus() -> None:
    c = check_python()
    assert c.status == "ok"
    assert c.required


def test_check_state_dir_creates_and_passes() -> None:
    c = check_state_dir()
    assert c.status == "ok"


def test_check_db_init_creates_db_and_returns_version() -> None:
    c = check_db_init()
    assert c.status == "ok"
    assert c.detail["schema_version"] >= 1


def test_check_repos_yaml_warns_when_missing() -> None:
    c = check_repos_yaml()
    assert c.status == "warn"


def test_check_validator_keys_warns_when_unset() -> None:
    c = check_validator_keys()
    assert c.status == "warn"


def test_run_doctor_returns_ok_false_only_when_required_fail() -> None:
    # In the test sandbox, claude/git/docker may not be installed in CI.
    # Use a fake check that we know fails.
    def fake_fail() -> Check:
        return Check(name="x", status="fail", required=True, message="...")

    checks, ok = run_doctor([check_python, fake_fail])
    assert ok is False
    json_out = to_json(checks, ok)
    parsed = json.loads(json_out)
    assert parsed["ok"] is False
    assert parsed["summary"]["fail"] == 1
    plain = to_plain(checks, ok)
    assert "FAIL" in plain
