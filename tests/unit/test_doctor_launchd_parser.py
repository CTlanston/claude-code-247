"""M18-P2: doctor.check_launchd reports plausible state."""
from __future__ import annotations

import json
import os

import pytest
from click.testing import CliRunner

from gateway.cli import cli
from gateway.doctor import check_launchd


def test_check_launchd_returns_check(monkeypatch: pytest.MonkeyPatch) -> None:
    c = check_launchd()
    assert c.name == "launchd"
    assert c.status in ("ok", "warn")
    assert "services" in c.detail
    # On a host without claude247 services loaded, expect warn
    if c.detail["loaded_count"] == 0:
        assert c.status == "warn"
        assert "install_launchd.sh" in c.message


def test_check_launchd_detail_shape() -> None:
    c = check_launchd()
    for key in ("services", "loaded", "loaded_count", "plists_present"):
        assert key in c.detail


def test_doctor_json_includes_launchd_check() -> None:
    r = CliRunner().invoke(cli, ["doctor", "--json"])
    assert r.exit_code in (0, 2)
    payload = json.loads(r.output)
    names = [c["name"] for c in payload["checks"]]
    assert "launchd" in names
