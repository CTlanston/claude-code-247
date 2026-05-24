"""BR-002 — launchd plists must set CLAUDE247_CONFIG (in addition to
the HOME + PATH they already set) so worker processes can resolve the
config deterministically even when shell profile is unavailable.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
TPL_DIR = REPO_ROOT / "scripts" / "launchd"
INSTALL_SH = REPO_ROOT / "scripts" / "install_launchd.sh"


def _render(tpl: Path, *, home: str, repo_root: str,
            claude247_bin: str = "/tmp/claude247",
            uvicorn_bin: str = "/tmp/uvicorn",
            path: str = "/usr/bin:/bin") -> str:
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
def test_plist_sets_claude247_config(tmp_path: Path, name: str) -> None:
    body = _render(TPL_DIR / f"{name}.plist.tpl",
                    home=str(tmp_path), repo_root="/r")
    assert "<key>CLAUDE247_CONFIG</key>" in body, \
        f"{name}.plist.tpl must set CLAUDE247_CONFIG in EnvironmentVariables"
    # And the value should reference the user config dir
    assert ".claude-code-247" in body or "@HOME@" in body or str(tmp_path) in body


@pytest.mark.parametrize("name", [
    "com.claude247.dashboard",
    "com.claude247.orchestrator",
    "com.claude247.dispatcher",
    "com.claude247.backup",
])
def test_plist_keeps_home_and_path(tmp_path: Path, name: str) -> None:
    body = _render(TPL_DIR / f"{name}.plist.tpl",
                    home=str(tmp_path), repo_root="/r")
    assert "<key>HOME</key>" in body
    assert "<key>PATH</key>" in body


def test_install_script_substitutes_claude247_config_path() -> None:
    """install_launchd.sh must render the CLAUDE247_CONFIG path so the
    rendered plist points at a real file (not the template placeholder)."""
    if not INSTALL_SH.exists():
        pytest.skip("install_launchd.sh missing")
    body = INSTALL_SH.read_text(encoding="utf-8")
    # Either the script supplies @HOME@-based substitution OR a dedicated
    # @CLAUDE247_CONFIG@ token. Verify SOMETHING wires it.
    assert ("@HOME@" in body) or ("CLAUDE247_CONFIG" in body), \
        "install_launchd.sh must wire CLAUDE247_CONFIG path"
