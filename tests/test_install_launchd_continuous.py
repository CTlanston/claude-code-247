"""Regression tests for scripts/install_launchd_continuous.sh (Cycle 27).

The script generates a macOS launchd plist for the L7 continuous-cycle
agent and (optionally) loads it. All tests run with
AUTODEV_LAUNCHD_DRY_RUN=1 so the real launchctl is never touched.

The fixture pattern: each test makes a tmp_path, sets AUTODEV_PLIST_PATH
into it, and asserts on file existence + plist content.
"""
from __future__ import annotations

import os
import plistlib
import subprocess
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "install_launchd_continuous.sh"


def _run(args, *, tmp_path: Path | None = None,
         extra_env: dict | None = None) -> subprocess.CompletedProcess:
    env = os.environ.copy()
    env["AUTODEV_LAUNCHD_DRY_RUN"] = "1"
    if tmp_path is not None:
        env["AUTODEV_PLIST_PATH"] = str(tmp_path / "agent.plist")
        env["AUTODEV_REPO_ROOT"] = str(tmp_path)
    if extra_env:
        env.update({k: str(v) for k, v in extra_env.items()})
    return subprocess.run(
        [str(SCRIPT), *args],
        capture_output=True, text=True, env=env, timeout=15,
    )


# --- Existence / executable --------------------------------------------


def test_script_exists():
    assert SCRIPT.exists()


def test_script_executable():
    assert os.access(SCRIPT, os.X_OK)


# --- --print-plist: plist generation -----------------------------------


def test_print_plist_emits_parseable_xml(tmp_path):
    r = _run(["--print-plist"], tmp_path=tmp_path)
    assert r.returncode == 0, r.stderr
    data = plistlib.loads(r.stdout.encode("utf-8"))
    assert data["Label"] == "com.lanston.autodev.continuous"


def test_plist_has_all_required_keys(tmp_path):
    r = _run(["--print-plist"], tmp_path=tmp_path)
    data = plistlib.loads(r.stdout.encode("utf-8"))
    required = {
        "Label",
        "ProgramArguments",
        "WorkingDirectory",
        "EnvironmentVariables",
        "StartInterval",
        "StandardOutPath",
        "StandardErrorPath",
        "ThrottleInterval",
        "RunAtLoad",
    }
    missing = required - set(data.keys())
    assert not missing, f"missing keys: {missing}"


def test_plist_program_runs_wake_script(tmp_path):
    r = _run(["--print-plist"], tmp_path=tmp_path)
    data = plistlib.loads(r.stdout.encode("utf-8"))
    pa = data["ProgramArguments"]
    assert pa[0] == "/bin/bash"
    assert pa[1].endswith("/scripts/autodev_continuous_cycle.sh"), pa


def test_plist_start_interval_default_is_900(tmp_path):
    r = _run(["--print-plist"], tmp_path=tmp_path)
    data = plistlib.loads(r.stdout.encode("utf-8"))
    assert data["StartInterval"] == 900


def test_plist_start_interval_honors_env(tmp_path):
    r = _run(
        ["--print-plist"], tmp_path=tmp_path,
        extra_env={"AUTODEV_INTERVAL_SECONDS": "1800"},
    )
    data = plistlib.loads(r.stdout.encode("utf-8"))
    assert data["StartInterval"] == 1800


def test_plist_target_l_default_is_5(tmp_path):
    r = _run(["--print-plist"], tmp_path=tmp_path)
    data = plistlib.loads(r.stdout.encode("utf-8"))
    assert data["EnvironmentVariables"]["AUTODEV_TARGET_L"] == "5"


def test_plist_target_l_honors_env(tmp_path):
    r = _run(
        ["--print-plist"], tmp_path=tmp_path,
        extra_env={"AUTODEV_TARGET_L": "6"},
    )
    data = plistlib.loads(r.stdout.encode("utf-8"))
    assert data["EnvironmentVariables"]["AUTODEV_TARGET_L"] == "6"


def test_plist_run_at_load_is_false(tmp_path):
    """We don't want immediate fire on install — launchd's first
    invocation should be StartInterval later. RunAtLoad=false."""
    r = _run(["--print-plist"], tmp_path=tmp_path)
    data = plistlib.loads(r.stdout.encode("utf-8"))
    assert data["RunAtLoad"] is False


def test_plist_throttle_interval_is_60(tmp_path):
    r = _run(["--print-plist"], tmp_path=tmp_path)
    data = plistlib.loads(r.stdout.encode("utf-8"))
    assert data["ThrottleInterval"] == 60


def test_plist_working_directory_is_repo(tmp_path):
    r = _run(["--print-plist"], tmp_path=tmp_path)
    data = plistlib.loads(r.stdout.encode("utf-8"))
    assert data["WorkingDirectory"] == str(tmp_path)


def test_plist_log_paths_inside_repo(tmp_path):
    r = _run(["--print-plist"], tmp_path=tmp_path)
    data = plistlib.loads(r.stdout.encode("utf-8"))
    assert data["StandardOutPath"].startswith(str(tmp_path))
    assert data["StandardOutPath"].endswith("/launchd.out.log")
    assert data["StandardErrorPath"].startswith(str(tmp_path))
    assert data["StandardErrorPath"].endswith("/launchd.err.log")


# --- --install -------------------------------------------------------


def test_install_writes_plist_file(tmp_path):
    r = _run(["--install"], tmp_path=tmp_path)
    assert r.returncode == 0, r.stderr
    plist_path = tmp_path / "agent.plist"
    assert plist_path.exists()
    # And it's a parseable plist
    data = plistlib.loads(plist_path.read_bytes())
    assert data["Label"] == "com.lanston.autodev.continuous"


def test_install_is_idempotent(tmp_path):
    """Two consecutive installs leave exactly one plist with the
    same contents (modulo nothing — it's a pure regen)."""
    r1 = _run(["--install"], tmp_path=tmp_path)
    assert r1.returncode == 0
    first_bytes = (tmp_path / "agent.plist").read_bytes()
    r2 = _run(["--install"], tmp_path=tmp_path)
    assert r2.returncode == 0
    second_bytes = (tmp_path / "agent.plist").read_bytes()
    assert first_bytes == second_bytes


def test_install_dry_run_does_not_invoke_launchctl(tmp_path):
    """Dry-run should print a hint that launchctl was skipped."""
    r = _run(["--install"], tmp_path=tmp_path)
    assert "[dry-run]" in r.stdout


# --- --uninstall ----------------------------------------------------


def test_uninstall_removes_plist(tmp_path):
    _run(["--install"], tmp_path=tmp_path)
    assert (tmp_path / "agent.plist").exists()
    r = _run(["--uninstall"], tmp_path=tmp_path)
    assert r.returncode == 0
    assert not (tmp_path / "agent.plist").exists()


def test_uninstall_when_not_installed_is_idempotent(tmp_path):
    """Uninstall with no plist present should still exit 0."""
    r = _run(["--uninstall"], tmp_path=tmp_path)
    assert r.returncode == 0
    assert "nothing to uninstall" in r.stdout.lower()


# --- --status ------------------------------------------------------


def test_status_when_not_installed(tmp_path):
    r = _run(["--status"], tmp_path=tmp_path)
    assert r.returncode == 0
    out = r.stdout
    assert "Label:" in out
    assert "com.lanston.autodev.continuous" in out
    assert "not installed" in out.lower()


def test_status_when_installed(tmp_path):
    _run(["--install"], tmp_path=tmp_path)
    r = _run(["--status"], tmp_path=tmp_path)
    assert r.returncode == 0
    out = r.stdout
    assert "exists" in out.lower()


def test_status_reports_stop_conditions(tmp_path):
    """If STOPSWITCH is present in the repo root, --status surfaces it."""
    (tmp_path / "reports").mkdir(parents=True, exist_ok=True)
    (tmp_path / "reports" / "STOPSWITCH").write_text("halt\n")
    r = _run(["--status"], tmp_path=tmp_path)
    assert r.returncode == 0
    assert "STOPSWITCH" in r.stdout


def test_status_reports_overall_level(tmp_path):
    (tmp_path / "LEVEL.md").write_text(
        "# LEVEL.md\n\nOverall L = 4\n"
    )
    r = _run(["--status"], tmp_path=tmp_path)
    assert r.returncode == 0
    assert "Overall L = 4" in r.stdout


# --- Unknown / bare invocation -----------------------------------


def test_unknown_flag_exits_nonzero(tmp_path):
    r = _run(["--bogus"], tmp_path=tmp_path)
    assert r.returncode != 0
    assert "unknown flag" in r.stderr.lower() or "usage" in r.stderr.lower()


def test_bare_invocation_exits_nonzero(tmp_path):
    """Calling with no args prints usage and exits 1."""
    r = _run([], tmp_path=tmp_path)
    assert r.returncode == 1
    assert "usage" in r.stderr.lower()


def test_help_flag_exits_zero(tmp_path):
    r = _run(["--help"], tmp_path=tmp_path)
    assert r.returncode == 0
    assert "usage" in r.stdout.lower()


# --- Plist file location safety --------------------------------------


def test_plist_label_is_l7_not_v3(tmp_path):
    """The L7 installer must NOT clobber the v3 supervisor agent.
    LABEL must be `com.lanston.autodev.continuous`, distinct from
    the v3 `com.autodev.supervisor`."""
    r = _run(["--print-plist"], tmp_path=tmp_path)
    data = plistlib.loads(r.stdout.encode("utf-8"))
    assert data["Label"] == "com.lanston.autodev.continuous"
    assert data["Label"] != "com.autodev.supervisor"


# --- Cycle β: HOME env + claude bin dir + no $HOME literal -----------


def test_plist_has_HOME_env(tmp_path):
    """EnvironmentVariables.HOME must be set as an absolute path so
    launchd-spawned children inherit a usable HOME (they don't get
    one from the user session). Without this, `claude` can't find
    its config dir under ~/.claude/ and degrades.
    """
    r = _run(
        ["--print-plist"], tmp_path=tmp_path,
        extra_env={"AUTODEV_HOME": "/Users/testuser"},
    )
    data = plistlib.loads(r.stdout.encode("utf-8"))
    env = data["EnvironmentVariables"]
    assert "HOME" in env, "plist EnvironmentVariables missing HOME"
    assert env["HOME"] == "/Users/testuser"
    assert env["HOME"].startswith("/"), "HOME must be an absolute path"


def test_plist_path_contains_claude_dir(tmp_path):
    """The plist PATH must contain the directory holding `claude` so
    launchd-spawned children can `command -v claude`. The install
    script auto-discovers it (Cycle β); AUTODEV_CLAUDE_BIN_DIR is
    the explicit override hook used here.
    """
    r = _run(
        ["--print-plist"], tmp_path=tmp_path,
        extra_env={"AUTODEV_CLAUDE_BIN_DIR": "/opt/fake/claude/bin"},
    )
    data = plistlib.loads(r.stdout.encode("utf-8"))
    path = data["EnvironmentVariables"]["PATH"]
    assert "/opt/fake/claude/bin" in path, (
        f"claude dir missing from plist PATH: {path}"
    )
    # And it should be FIRST so it wins over any later shadowing entry.
    assert path.split(":")[0] == "/opt/fake/claude/bin", (
        f"claude dir should be first in PATH, got: {path}"
    )


def test_no_unexpanded_home_variable(tmp_path):
    """The raw plist text must NOT contain literal `$HOME` or `${HOME}`
    — launchd does NOT expand env-var references inside plist strings,
    so any literal would break runtime path resolution.
    """
    r = _run(
        ["--print-plist"], tmp_path=tmp_path,
        extra_env={
            "AUTODEV_HOME": "/Users/testuser",
            "AUTODEV_CLAUDE_BIN_DIR": "/opt/fake/claude/bin",
        },
    )
    assert "$HOME" not in r.stdout, (
        "literal $HOME found in plist — launchd won't expand it"
    )
    assert "${HOME}" not in r.stdout, (
        "literal ${HOME} found in plist — launchd won't expand it"
    )


def test_plist_xml_valid_plutil_lint(tmp_path):
    """`plutil -lint` is macOS's authoritative plist parser; if it
    rejects ours, launchd will too. Skip on non-Darwin (CI).
    """
    import platform
    if platform.system() != "Darwin":
        pytest.skip("plutil only available on macOS")
    plist_file = tmp_path / "lint.plist"
    r = _run(
        ["--print-plist"], tmp_path=tmp_path,
        extra_env={
            "AUTODEV_HOME": "/Users/testuser",
            "AUTODEV_CLAUDE_BIN_DIR": "/opt/fake/claude/bin",
        },
    )
    plist_file.write_text(r.stdout)
    lint = subprocess.run(
        ["plutil", "-lint", str(plist_file)],
        capture_output=True, text=True, timeout=10,
    )
    assert lint.returncode == 0, (
        f"plutil -lint rejected the generated plist:\n"
        f"stdout: {lint.stdout}\nstderr: {lint.stderr}"
    )


# --- Cycle γ: --dry-run operator-facing simulation -------------------


def test_dry_run_exits_zero_and_writes_no_file(tmp_path):
    """`--dry-run` must be a pure-stdout operation: exit 0, plist
    file MUST NOT appear on disk afterward."""
    r = _run(["--dry-run"], tmp_path=tmp_path)
    assert r.returncode == 0, r.stderr
    assert r.stdout != "", "dry-run produced no output"
    # The configured AUTODEV_PLIST_PATH is tmp_path/agent.plist; it
    # MUST NOT exist after dry-run.
    assert not (tmp_path / "agent.plist").exists(), (
        "dry-run wrote a plist file — violates the dry-run contract"
    )


def test_dry_run_includes_target_path(tmp_path):
    """`--dry-run` must show WHERE the plist would land so the
    operator can verify the destination before committing to install."""
    r = _run(["--dry-run"], tmp_path=tmp_path)
    assert str(tmp_path / "agent.plist") in r.stdout, (
        f"dry-run output missing target plist path; got:\n{r.stdout[:500]}"
    )


def test_dry_run_includes_plist_body(tmp_path):
    """The plist XML must be embedded inside the dry-run output so
    the operator can visually verify the EnvironmentVariables (HOME,
    PATH) AND the absence of $HOME literals before any actual install."""
    r = _run(["--dry-run"], tmp_path=tmp_path)
    assert "<key>Label</key>" in r.stdout
    assert "com.lanston.autodev.continuous" in r.stdout
    # And no literal $HOME / ${HOME} (Cycle β's safety property
    # extends to dry-run output too).
    assert "$HOME" not in r.stdout
    assert "${HOME}" not in r.stdout


def test_dry_run_plist_body_is_valid_plist(tmp_path):
    """Extract the plist XML from --dry-run output (between the
    XML prolog and the closing </plist>) and confirm it parses."""
    r = _run(
        ["--dry-run"], tmp_path=tmp_path,
        extra_env={
            "AUTODEV_HOME": "/Users/testuser",
            "AUTODEV_CLAUDE_BIN_DIR": "/opt/fake/claude/bin",
        },
    )
    assert r.returncode == 0
    # Find the embedded plist XML
    start = r.stdout.find("<?xml")
    end = r.stdout.find("</plist>")
    assert start != -1 and end != -1, (
        f"could not locate plist XML in dry-run output; got:\n{r.stdout[:500]}"
    )
    plist_xml = r.stdout[start : end + len("</plist>")]
    data = plistlib.loads(plist_xml.encode("utf-8"))
    # Same invariants the --print-plist tests assert
    assert data["Label"] == "com.lanston.autodev.continuous"
    assert data["EnvironmentVariables"]["HOME"] == "/Users/testuser"
    assert "/opt/fake/claude/bin" in data["EnvironmentVariables"]["PATH"]


def test_dry_run_does_not_invoke_launchctl(tmp_path):
    """`--dry-run` must explicitly mention the launchctl commands that
    `--install` would run, but it must NOT invoke them. We can't
    intercept launchctl from a unit test, but we can confirm the
    output is informational and the dry-run command echoes them.
    """
    r = _run(["--dry-run"], tmp_path=tmp_path)
    # The simulation should mention `launchctl load -w` so operators
    # know what would happen — but we never actually run it (the test
    # framework already sets AUTODEV_LAUNCHD_DRY_RUN=1, and the
    # _cmd_dry_run path doesn't call _launchctl at all).
    assert "launchctl" in r.stdout, (
        "dry-run should describe the launchctl commands that --install "
        "would invoke; got:\n" + r.stdout[:500]
    )
    assert "load -w" in r.stdout


def test_human_config_interval_used_when_env_unset(tmp_path):
    """When AUTODEV_INTERVAL_SECONDS is unset, the install script reads
    `launchd_interval_seconds` from HUMAN_CONFIG.md (Cycle ε)."""
    (tmp_path / "HUMAN_CONFIG.md").write_text(
        "## runtime\n```yaml\nruntime:\n  launchd_interval_seconds: 3600\n```\n"
    )
    # _run() always sets AUTODEV_REPO_ROOT=tmp_path; need to make sure
    # AUTODEV_INTERVAL_SECONDS is NOT in env. The base env starts from
    # os.environ.copy() which doesn't have it set in test runs.
    env_override = {}
    # Explicitly clear if a shell happens to export it
    import os
    if "AUTODEV_INTERVAL_SECONDS" in os.environ:
        pytest.skip("test requires AUTODEV_INTERVAL_SECONDS unset in env")
    r = _run(["--print-plist"], tmp_path=tmp_path, extra_env=env_override)
    assert r.returncode == 0
    data = plistlib.loads(r.stdout.encode("utf-8"))
    assert data["StartInterval"] == 3600, (
        f"expected StartInterval=3600 from HUMAN_CONFIG; got {data['StartInterval']}"
    )


def test_env_interval_wins_over_human_config(tmp_path):
    """AUTODEV_INTERVAL_SECONDS env wins over HUMAN_CONFIG.md value
    (env is the higher-priority test/operator override)."""
    (tmp_path / "HUMAN_CONFIG.md").write_text(
        "runtime:\n  launchd_interval_seconds: 3600\n"
    )
    r = _run(
        ["--print-plist"], tmp_path=tmp_path,
        extra_env={"AUTODEV_INTERVAL_SECONDS": "1200"},
    )
    assert r.returncode == 0
    data = plistlib.loads(r.stdout.encode("utf-8"))
    assert data["StartInterval"] == 1200, (
        f"AUTODEV_INTERVAL_SECONDS env should win; got {data['StartInterval']}"
    )


def test_dry_run_idempotent_byte_identical(tmp_path):
    """Two consecutive `--dry-run` invocations with the same env produce
    byte-identical output APART from the timestamp header line. This
    is the operator's confidence signal that `--install`'s plist
    contents are deterministic (the timestamp header is in the
    simulation preamble only, NOT in the plist body)."""
    r1 = _run(
        ["--dry-run"], tmp_path=tmp_path,
        extra_env={
            "AUTODEV_HOME": "/Users/testuser",
            "AUTODEV_CLAUDE_BIN_DIR": "/opt/fake/claude/bin",
        },
    )
    r2 = _run(
        ["--dry-run"], tmp_path=tmp_path,
        extra_env={
            "AUTODEV_HOME": "/Users/testuser",
            "AUTODEV_CLAUDE_BIN_DIR": "/opt/fake/claude/bin",
        },
    )
    # Strip the timestamped header line; the rest must be identical.
    def _strip_ts(text: str) -> str:
        lines = text.splitlines(keepends=True)
        return "".join(
            ln for ln in lines if "DRY RUN @" not in ln
        )
    assert _strip_ts(r1.stdout) == _strip_ts(r2.stdout), (
        "dry-run output diverges between runs (excluding timestamp); "
        "plist body or simulation header is non-deterministic"
    )
