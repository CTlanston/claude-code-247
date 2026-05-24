"""BR-002 — `claude247 doctor --json` reports config source + env-file
provenance so an operator can diagnose "why is OPENAI_API_KEY not
picked up" without strace.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import pytest


def test_doctor_emits_config_block(tmp_path: Path,
                                     monkeypatch: pytest.MonkeyPatch) -> None:
    user = tmp_path / "user_cfg"
    user.mkdir()
    (user / "config.yaml").write_text("system: {}\n")
    monkeypatch.setenv("CLAUDE247_CONFIG_DIR", str(user))

    from gateway.doctor import check_config_source
    check = check_config_source()

    assert check.name
    assert check.status in {"ok", "warn", "fail"}
    for key in ("cwd", "config_source", "env_files_loaded",
                 "worker_mode", "allow_api_fallback"):
        assert key in check.detail, f"missing config.{key}"


def test_doctor_records_worker_mode_and_no_fallback(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = tmp_path / "user_cfg"
    user.mkdir()
    (user / "config.yaml").write_text(
        "system: {}\nauth: {worker_mode: local_claude_code, "
        "allow_api_fallback: false}\n"
    )
    monkeypatch.setenv("CLAUDE247_CONFIG_DIR", str(user))

    from gateway.doctor import check_config_source
    check = check_config_source()

    assert check.detail["worker_mode"] == "local_claude_code"
    assert check.detail["allow_api_fallback"] is False


def test_doctor_lists_loaded_env_files(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = tmp_path / "user_cfg"
    user.mkdir()
    (user / "config.yaml").write_text("system: {}\n")
    (user / ".env").write_text("DOCTOR_PROBE_KEY=1\n")
    monkeypatch.setenv("CLAUDE247_CONFIG_DIR", str(user))

    from gateway.doctor import check_config_source
    check = check_config_source()

    env_files = check.detail["env_files_loaded"]
    assert isinstance(env_files, list)
    # The user .env path should be among the discovered set
    assert any(str(user / ".env") in str(p) for p in env_files)


def test_doctor_json_includes_config_check(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = tmp_path / "user_cfg"
    user.mkdir()
    (user / "config.yaml").write_text("system: {}\n")
    monkeypatch.setenv("CLAUDE247_CONFIG_DIR", str(user))

    from gateway.doctor import check_config_source, run_doctor, to_json
    results, ok = run_doctor(checks=[check_config_source])
    payload = json.loads(to_json(results, ok))
    names = [c["name"] for c in payload["checks"]]
    # exact name not pinned in the test — just verify ours appears
    assert any("config" in n.lower() for n in names)


def test_doctor_config_source_returns_warn_when_no_config(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    empty = tmp_path / "empty"
    empty.mkdir()  # no config.yaml inside
    monkeypatch.setenv("CLAUDE247_CONFIG_DIR", str(empty))
    monkeypatch.delenv("CLAUDE247_CONFIG", raising=False)

    from gateway.doctor import check_config_source
    check = check_config_source()
    # Either explicitly warn that no config file was found, or report
    # config_source as None — both are honest. What we forbid is
    # silently picking a bogus path.
    assert check.detail["config_source"] in (None, "(none)") or check.status == "warn"
