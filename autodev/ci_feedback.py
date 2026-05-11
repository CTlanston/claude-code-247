"""CIFeedback — wraps the existing CI-log extractor.

The inner engine's `orchestrator/github_client.py:latest_workflow_failure_summary`
already does the heavy lifting (job-log download, error-line extraction). We
expose a stable function here so AutoDev can format that output uniformly
across tools (Ruff, pytest, mypy/pyright, GitHub Actions shell).

Currently a passthrough; future work could add language-specific parsers
(Node test output, Rust cargo, etc.) without rewriting the inner engine.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional


def _project_root() -> Path:
    return Path(__file__).resolve().parent.parent


@dataclass
class CIResult:
    branch: str
    conclusion: str  # success | failure | running | None
    summary: str
    raw_excerpt: str
    failed_jobs: list[str]


def latest_for_branch(branch: str) -> CIResult:
    """Return the latest CI state for a branch using the inner engine's
    github_client. Lazy import keeps the supervisor decoupled from PyGithub
    when running in dry-run / offline mode."""
    try:
        # late binding so missing optional deps don't crash import
        import sys
        sys.path.insert(0, str(_project_root()))
        from orchestrator import github_client as gh  # type: ignore
    except Exception as e:  # noqa: BLE001
        return CIResult(branch, "unknown", f"github_client import failed: {e}", "", [])

    try:
        conclusion = gh.latest_workflow_run_status(branch) or "unknown"
        summary = gh.latest_workflow_failure_summary(branch) if conclusion == "failure" else ""
    except Exception as e:  # noqa: BLE001
        return CIResult(branch, "unknown", f"github_client error: {e}", "", [])

    return CIResult(
        branch=branch,
        conclusion=conclusion,
        summary=summary,
        raw_excerpt=summary[:2000],
        failed_jobs=[],
    )


def parse_local_pytest(output: str) -> dict:
    """Parse a captured `pytest -q` run into a small dict for state.json.

    We deliberately don't shell out — call sites pass the captured stdout."""
    info = {"passed": 0, "failed": 0, "errors": 0, "skipped": 0, "summary": ""}
    last_line = ""
    for line in output.splitlines():
        if line.strip().startswith("==") and ("passed" in line or "failed" in line or "error" in line):
            last_line = line.strip()
            continue
    info["summary"] = last_line
    # Very loose extraction — pytest's `=== 3 passed, 1 failed ===` form.
    import re
    for key, label in [("passed", "passed"), ("failed", "failed"),
                       ("errors", "error"), ("skipped", "skipped")]:
        m = re.search(rf"(\d+)\s+{label}", last_line)
        if m:
            info[key] = int(m.group(1))
    return info


def parse_ruff(output: str) -> dict:
    """Parse ruff output. Ruff prints `Found N errors.` and per-error code."""
    info = {"errors": 0, "summary": "", "codes": []}
    import re
    m = re.search(r"Found\s+(\d+)\s+errors?\.", output)
    if m:
        info["errors"] = int(m.group(1))
    info["summary"] = (output.splitlines() or [""])[-1].strip()
    info["codes"] = sorted(set(re.findall(r"\b([A-Z]\d{3,4})\b", output)))
    return info
