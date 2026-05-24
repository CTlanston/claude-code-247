"""M18-P0: doctor reports the worker_mode + ANTHROPIC_API_KEY status
clearly so the operator can see at a glance whether they're about to
spend money."""
from __future__ import annotations

import json
import os
from pathlib import Path

import pytest
import yaml
from click.testing import CliRunner

from gateway.cli import cli
from gateway.doctor import check_auth_mode


def _write_config(**overrides) -> None:
    cfg_dir = Path(os.environ["CLAUDE247_CONFIG_DIR"])
    (cfg_dir / "config.yaml").write_text(yaml.safe_dump({"auth": overrides}))


def test_doctor_check_auth_mode_local_with_api_key_warns(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    c = check_auth_mode()
    assert c.detail["worker_mode"] == "local_claude_code"
    assert c.detail["anthropic_api_key_present"] is True
    assert c.detail["anthropic_api_used_for_workers"] is False
    assert "IGNORED for workers" in c.message


def test_doctor_check_auth_mode_api_without_key_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    _write_config(worker_mode="anthropic_api")
    c = check_auth_mode()
    assert c.status == "fail"
    assert c.detail["worker_mode"] == "anthropic_api"
    assert c.detail["anthropic_api_used_for_workers"] is True


def test_doctor_check_auth_mode_api_with_key_passes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    _write_config(worker_mode="anthropic_api")
    c = check_auth_mode()
    assert c.status == "ok"
    assert c.detail["anthropic_api_used_for_workers"] is True


def test_doctor_check_auth_mode_local_without_api_key() -> None:
    # No API key in env (conftest deletes it) — local mode usable
    # (claude CLI assumed to be installed on test host).
    c = check_auth_mode()
    assert c.detail["worker_mode"] == "local_claude_code"
    assert c.detail["anthropic_api_key_present"] is False


def test_doctor_json_includes_auth_mode_check() -> None:
    r = CliRunner().invoke(cli, ["doctor", "--json"])
    assert r.exit_code in (0, 2)
    payload = json.loads(r.output)
    names = [c["name"] for c in payload["checks"]]
    assert "auth mode" in names


def test_doctor_json_auth_check_detail_shape() -> None:
    r = CliRunner().invoke(cli, ["doctor", "--json"])
    payload = json.loads(r.output)
    auth_check = next(c for c in payload["checks"] if c["name"] == "auth mode")
    for key in ("worker_mode", "usable", "anthropic_api_key_present",
                 "anthropic_api_used_for_workers", "allow_api_fallback"):
        assert key in auth_check["detail"], f"missing {key} in auth detail"
