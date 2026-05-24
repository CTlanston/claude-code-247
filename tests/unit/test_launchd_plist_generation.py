"""M18-P2: launchd plist templates render the right XML shape.

We don't invoke launchctl from CI — that's environment-specific. But
the rendered XML must conform to the plist DTD and contain the
expected keys; that's a unit-testable property of the template +
install script."""
from __future__ import annotations

import re
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
TPL_DIR = REPO_ROOT / "scripts" / "launchd"
INSTALL_SH = REPO_ROOT / "scripts" / "install_launchd.sh"


def _render(tpl: Path, *, home: str, repo_root: str,
            claude247_bin: str = "/tmp/claude247",
            uvicorn_bin: str = "/tmp/uvicorn",
            path: str = "/usr/bin:/bin") -> str:
    """Mirror install_launchd.sh's sed substitution. Kept as a
    test-only helper so the unit test doesn't shell out."""
    body = tpl.read_text(encoding="utf-8")
    body = body.replace("@HOME@", home)
    body = body.replace("@REPO_ROOT@", repo_root)
    body = body.replace("@CLAUDE247_BIN@", claude247_bin)
    body = body.replace("@UVICORN_BIN@", uvicorn_bin)
    body = body.replace("@PATH@", path)
    return body


@pytest.mark.parametrize("name", [
    "com.claude247.dashboard",
    "com.claude247.orchestrator",
    "com.claude247.dispatcher",
    "com.claude247.backup",
])
def test_plist_template_exists(name: str) -> None:
    p = TPL_DIR / f"{name}.plist.tpl"
    assert p.exists(), f"missing template: {p}"


@pytest.mark.parametrize("name", [
    "com.claude247.dashboard",
    "com.claude247.orchestrator",
    "com.claude247.dispatcher",
    "com.claude247.backup",
])
def test_rendered_plist_is_valid_xml(tmp_path: Path, name: str) -> None:
    tpl = TPL_DIR / f"{name}.plist.tpl"
    body = _render(tpl, home=str(tmp_path), repo_root="/r")
    # Strip the DOCTYPE — ElementTree's default parser doesn't follow it
    # but we still want to assert structural validity.
    body_no_doctype = re.sub(r"<!DOCTYPE[^>]*>", "", body, count=1)
    root = ET.fromstring(body_no_doctype)
    assert root.tag == "plist"
    dict_el = root.find("dict")
    assert dict_el is not None
    # Expect at least Label + ProgramArguments
    keys = [k.text for k in dict_el.findall("key")]
    assert "Label" in keys
    assert "ProgramArguments" in keys


def test_dispatcher_plist_has_start_interval(tmp_path: Path) -> None:
    body = _render(TPL_DIR / "com.claude247.dispatcher.plist.tpl",
                    home=str(tmp_path), repo_root="/r")
    # 30-second tick per M11 design
    assert "<key>StartInterval</key>" in body
    assert "<integer>30</integer>" in body


def test_backup_plist_uses_calendar_interval(tmp_path: Path) -> None:
    body = _render(TPL_DIR / "com.claude247.backup.plist.tpl",
                    home=str(tmp_path), repo_root="/r")
    # Daily at a specific time, not StartInterval
    assert "<key>StartCalendarInterval</key>" in body
    assert "<key>Hour</key>" in body


def test_dashboard_plist_keeps_alive(tmp_path: Path) -> None:
    body = _render(TPL_DIR / "com.claude247.dashboard.plist.tpl",
                    home=str(tmp_path), repo_root="/r")
    assert "<key>KeepAlive</key>" in body
    assert "<true/>" in body


def test_install_script_lists_all_four_services() -> None:
    assert INSTALL_SH.exists()
    body = INSTALL_SH.read_text(encoding="utf-8")
    for name in ("com.claude247.dashboard", "com.claude247.orchestrator",
                  "com.claude247.dispatcher", "com.claude247.backup"):
        assert name in body, f"install_launchd.sh missing {name}"


def test_uninstall_script_lists_same_services() -> None:
    uninstall = REPO_ROOT / "scripts" / "uninstall_launchd.sh"
    assert uninstall.exists()
    body = uninstall.read_text(encoding="utf-8")
    for name in ("com.claude247.dashboard", "com.claude247.orchestrator",
                  "com.claude247.dispatcher", "com.claude247.backup"):
        assert name in body, f"uninstall_launchd.sh missing {name}"


def test_doctor_launchd_script_exists_and_executable() -> None:
    script = REPO_ROOT / "scripts" / "doctor_launchd.sh"
    assert script.exists()
    # Owner-executable
    import os, stat as _stat
    assert _stat.S_IXUSR & os.stat(script).st_mode
    # bash shebang
    assert script.read_text().startswith("#!/usr/bin/env bash")
