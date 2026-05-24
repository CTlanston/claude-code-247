"""GitHub API thin wrapper. All write ops funnel through here for audit.

In LOCAL_MODE we substitute a file-backed stub so the orchestrator can be tested
without a real repo. Stub state lives at $WORKSPACE_ROOT/_github_stub/.
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

_TOKEN = os.getenv("GITHUB_TOKEN")
_REPO_NAME = os.getenv("GITHUB_REPO")


def _local_mode() -> bool:
    return os.getenv("LOCAL_MODE", "0") == "1" or (not _TOKEN) or "PLACEHOLDER" in (_TOKEN or "")


def _stub_dir() -> Path:
    root = Path(os.getenv("WORKSPACE_ROOT", "/tmp/claude-247-workspaces"))
    d = root / "_github_stub"
    d.mkdir(parents=True, exist_ok=True)
    (d / "issues").mkdir(exist_ok=True)
    (d / "prs").mkdir(exist_ok=True)
    (d / "comments").mkdir(exist_ok=True)
    return d


def _gh():
    """Lazy real-GitHub client."""
    from github import Github, Auth
    return Github(auth=Auth.Token(_TOKEN)).get_repo(_REPO_NAME)


# ----- Issue I/O ------------------------------------------------------------

def list_auto_issues():
    """Return objects with .number, .title, .body."""
    if _local_mode():
        d = _stub_dir() / "issues"
        out = []
        for f in sorted(d.glob("*.json")):
            data = json.loads(f.read_text())
            if data.get("state") != "open":
                continue
            if "agent:auto" not in (data.get("labels") or []):
                continue
            out.append(_StubIssue(data))
        return out
    # IMPORTANT: GitHub's REST `/repos/.../issues` endpoint returns BOTH
    # issues and pull requests (a PR is internally an issue). Without the
    # pull_request filter, the orchestrator picks up its own newly-opened
    # PRs (which carry the agent:auto label from add_pr_label) as if they
    # were fresh tasks and loops infinitely. Discovered when issue #6 spawned
    # 4 duplicate PRs (#7-#10) in <1 hour.
    return [i for i in _gh().get_issues(state="open", labels=["agent:auto"])
            if i.pull_request is None]


def add_label(issue_number: int, label: str) -> None:
    if _local_mode():
        f = _stub_dir() / "issues" / f"{issue_number}.json"
        if f.exists():
            data = json.loads(f.read_text())
            labels = set(data.get("labels") or [])
            labels.add(label)
            data["labels"] = sorted(labels)
            f.write_text(json.dumps(data, indent=2))
        return
    _gh().get_issue(issue_number).add_to_labels(label)


def comment(issue_number: int, body: str) -> None:
    if _local_mode():
        d = _stub_dir() / "comments" / str(issue_number)
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{int(time.time()*1000)}.md").write_text(body)
        return
    _gh().get_issue(issue_number).create_comment(body)


# ----- PR I/O ---------------------------------------------------------------

def open_pr(head_branch: str, title: str, body: str, base: Optional[str] = None) -> int:
    base = base or os.getenv("GITHUB_DEFAULT_BRANCH", "main")
    if _local_mode():
        d = _stub_dir() / "prs"
        existing = list(d.glob("*.json"))
        # Avoid duplicate PR for the same branch.
        for f in existing:
            data = json.loads(f.read_text())
            if data.get("head") == head_branch and data.get("state") == "open":
                return data["number"]
        pr_no = (max((int(f.stem) for f in existing), default=0)) + 1
        (d / f"{pr_no}.json").write_text(json.dumps({
            "number": pr_no,
            "head": head_branch,
            "base": base,
            "title": title,
            "body": body,
            "state": "open",
            "draft": True,
            "labels": [],
            "created_at": time.time(),
        }, indent=2))
        return pr_no
    pr = _gh().create_pull(title=title, body=body, head=head_branch, base=base, draft=True)
    return pr.number


def add_pr_label(pr_number: int, label: str) -> None:
    if _local_mode():
        f = _stub_dir() / "prs" / f"{pr_number}.json"
        if f.exists():
            data = json.loads(f.read_text())
            labels = set(data.get("labels") or [])
            labels.add(label)
            data["labels"] = sorted(labels)
            f.write_text(json.dumps(data, indent=2))
        return
    # On real GitHub a PR is just an issue under the hood.
    _gh().get_issue(pr_number).add_to_labels(label)


def latest_workflow_run_status(branch: str) -> Optional[str]:
    """Return 'success'|'failure'|'running'|None.

    LOCAL_MODE: read from a file the local-CI shim writes
    ($WORKSPACE_ROOT/_github_stub/ci/<branch>.json)."""
    if _local_mode():
        f = _stub_dir() / "ci" / f"{branch.replace('/', '__')}.json"
        if not f.exists():
            return None
        data = json.loads(f.read_text())
        return data.get("status")
    # Defensive: PyGithub's PaginatedList can raise IndexError / GithubException
    # on missing branches or transient API hiccups. ANY exception here used to
    # bubble up through main_oneshot and freeze the entire inner-engine loop
    # for ALL issues (E2E test 2026-05-11 fail mode). Swallow and return None
    # so the engine moves on to the next task.
    try:
        runs = _gh().get_workflow_runs(branch=branch)
        try:
            total = runs.totalCount
        except Exception:  # noqa: BLE001
            total = None
        if total == 0:
            return None
        for run in runs[:1]:
            return run.conclusion or "running"
        return None
    except Exception as e:  # noqa: BLE001
        log.warning("latest_workflow_run_status(%s) failed: %s", branch, e)
        return None


_ERROR_LINE_RE = re.compile(
    r"(##\[error\]|^E\s|FAIL|error:|Error:|\bF[0-9]{3,}\b|TypeError|ValueError|"
    r"AssertionError|Traceback|Failed|exit code [^0]|fail\b)",
    re.IGNORECASE,
)


def _extract_error_lines(log_text: str, context: int = 3, max_chars: int = 2000) -> str:
    """Pull lines that look like error output, with a few lines of context
    around each match. CI logs are long; we want the model to see the cause,
    not the cleanup."""
    raw_lines = log_text.splitlines()
    # Strip the timestamp prefix that GitHub Actions adds (`2026-05-08T...Z `).
    stripped = []
    for line in raw_lines:
        m = re.match(r"^\s*\d{4}-\d{2}-\d{2}T[\d:.]+Z\s(.*)", line)
        stripped.append(m.group(1) if m else line)

    keep: set = set()
    for i, line in enumerate(stripped):
        if _ERROR_LINE_RE.search(line):
            for j in range(max(0, i - context), min(len(stripped), i + context + 1)):
                keep.add(j)

    if not keep:
        # No clear error markers — fall back to the tail.
        return "\n".join(stripped[-25:])[-max_chars:]

    out_lines = []
    last_idx = -2
    for i in sorted(keep):
        if i > last_idx + 1:
            out_lines.append("…")
        out_lines.append(stripped[i])
        last_idx = i
    out = "\n".join(out_lines)
    if len(out) > max_chars:
        out = out[-max_chars:]
    return out


def latest_workflow_failure_summary(branch: str, max_chars: int = 2500) -> str:
    """When the most recent CI run on `branch` has failed, return a short
    human-readable summary of the failed job(s) so the Coder can fix the
    actual problem instead of guessing. Returns '' on success/error."""
    if _local_mode():
        return ""
    try:
        runs = _gh().get_workflow_runs(branch=branch)
        run = next(iter(runs[:1]), None)
        if not run or run.conclusion != "failure":
            return ""
        lines = [f"CI run #{run.id} ({run.html_url}) failed:"]
        for job in run.jobs():
            if job.conclusion in (None, "success", "skipped", "cancelled"):
                continue
            lines.append(f"\n=== job: {job.name} ({job.conclusion}) ===")
            # Job log is plain text; fetch via raw API since PyGithub doesn't
            # expose a clean accessor.
            import httpx
            r = httpx.get(
                f"https://api.github.com/repos/{_REPO_NAME}/actions/jobs/{job.id}/logs",
                headers={"Authorization": f"Bearer {_TOKEN}",
                         "Accept": "application/vnd.github+json"},
                follow_redirects=True, timeout=15,
            )
            if r.status_code == 200:
                # The error message usually appears in the middle of the log
                # (long preamble before, cleanup output after). Pull lines that
                # look error-relevant — including a few lines of context after
                # each match, since stack traces span multiple lines.
                lines.append(_extract_error_lines(r.text))
            else:
                lines.append(f"(could not fetch log: HTTP {r.status_code})")
        out = "\n".join(lines)
        return out[-max_chars:] if len(out) > max_chars else out
    except Exception as e:  # noqa: BLE001
        return f"(failed to summarise CI failure: {e})"


# ----- Stub helpers ---------------------------------------------------------

class _StubIssue:
    def __init__(self, data: dict):
        self.number = data["number"]
        self.title = data.get("title", "")
        self.body = data.get("body", "")


def _stub_create_issue(number: int, title: str, body: str = "", labels: Optional[list] = None) -> None:
    """Test-helper: drop a fake issue into the stub queue."""
    f = _stub_dir() / "issues" / f"{number}.json"
    f.write_text(json.dumps({
        "number": number,
        "title": title,
        "body": body,
        "state": "open",
        "labels": labels or ["agent:auto"],
    }, indent=2))


def _stub_set_ci(branch: str, status: str) -> None:
    d = _stub_dir() / "ci"
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{branch.replace('/', '__')}.json").write_text(json.dumps({"status": status}))
