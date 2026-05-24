"""Thin `gh` CLI wrapper.

We deliberately shell out to `gh` instead of pulling in PyGithub: gh is
already a doctor-checked dependency, handles auth + retries + paging,
and stays consistent with what an operator would type by hand.

Every function returns a typed result (or raises ``GitHubError``) so the
dispatcher can branch cleanly. All functions are tested via subprocess
mock so no network is required in CI.

Safety: the wrapper itself does NOT consult ``system.allow_remote_writes``.
That check belongs to the caller (dispatcher) — we keep this layer pure
"do what gh does" and let policy decide whether to call it.
"""
from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class PullRequest:
    repo: str               # "owner/repo"
    number: int
    url: str
    branch: str
    title: str
    state: str              # draft|open|merged|closed (best-effort from gh)
    raw: dict[str, Any]


class GitHubError(RuntimeError):
    pass


def _run(argv: list[str], *, timeout: float = 60.0) -> tuple[int, str, str]:
    try:
        proc = subprocess.run(argv, capture_output=True, text=True, timeout=timeout)
        return proc.returncode, proc.stdout, proc.stderr
    except (FileNotFoundError, OSError, subprocess.TimeoutExpired) as e:
        raise GitHubError(f"failed to invoke {argv[0]}: {e}") from e


def create_draft_pr(
    *,
    repo: str,
    branch: str,
    title: str,
    body: str,
    base: str = "main",
    label: str | None = None,
    workspace: str | None = None,
) -> PullRequest:
    """Open a draft PR. ``repo`` is "owner/repo". ``branch`` must already
    be pushed to that repo. Returns the parsed PR record."""
    argv = ["gh", "pr", "create", "--repo", repo, "--draft",
             "--base", base, "--head", branch,
             "--title", title, "--body", body]
    if label:
        argv += ["--label", label]
    rc, out, err = _run(argv)
    if rc != 0:
        raise GitHubError(f"gh pr create failed (rc={rc}): {err.strip() or out.strip()}")
    # `gh pr create` prints the URL on success
    url = out.strip().splitlines()[-1].strip() if out.strip() else ""
    if not url:
        raise GitHubError(f"gh pr create produced no URL; stderr={err.strip()}")
    number = _extract_pr_number(url)
    return PullRequest(
        repo=repo, number=number, url=url, branch=branch,
        title=title, state="draft", raw={"create_stdout": out},
    )


def view_pr(repo: str, number: int) -> PullRequest:
    """Return the current state of a PR via `gh pr view --json`."""
    fields = "number,url,state,title,headRefName,isDraft,mergedAt,mergeable,mergeStateStatus"
    rc, out, err = _run(["gh", "pr", "view", str(number), "--repo", repo,
                          "--json", fields])
    if rc != 0:
        raise GitHubError(f"gh pr view failed (rc={rc}): {err.strip()}")
    try:
        data = json.loads(out)
    except json.JSONDecodeError as e:
        raise GitHubError(f"gh pr view returned non-JSON: {out[:200]}") from e
    return PullRequest(
        repo=repo,
        number=int(data.get("number") or number),
        url=str(data.get("url") or ""),
        branch=str(data.get("headRefName") or ""),
        title=str(data.get("title") or ""),
        state=_state_from_view(data),
        raw=data,
    )


def merge_pr(
    *,
    repo: str,
    number: int,
    method: str = "squash",
    delete_branch: bool = True,
    body: str = "",
    auto: bool = False,
    admin: bool = False,
) -> bool:
    """`gh pr merge`. Returns True on success.

    ``method`` ∈ {squash, rebase, merge}. Squash is the default.

    ``auto`` adds ``--auto`` (queue the merge after required checks
    pass). Default False because most repos don't have auto-merge
    enabled at the GitHub settings level — passing --auto then fails.

    ``admin`` adds ``--admin`` (bypass branch protection rules).
    Default False — only operators who own the repo should set this.
    Required when the repo has a branch-protection policy that would
    otherwise block direct merges (and --auto isn't enabled). The
    dispatcher reads this from repo.auto_merge.admin in the registry.
    """
    if method not in ("squash", "rebase", "merge"):
        raise ValueError(f"unknown merge method {method!r}")
    argv = ["gh", "pr", "merge", str(number), "--repo", repo, f"--{method}"]
    if auto:
        argv.append("--auto")
    if admin:
        argv.append("--admin")
    if delete_branch:
        argv.append("--delete-branch")
    if body:
        argv += ["--body", body]
    rc, out, err = _run(argv, timeout=120.0)
    if rc != 0:
        raise GitHubError(f"gh pr merge failed (rc={rc}): {err.strip() or out.strip()}")
    return True


def pr_comment(repo: str, number: int, body: str) -> bool:
    """Post a comment on a PR. Used to attach evidence-package summaries."""
    rc, out, err = _run(["gh", "pr", "comment", str(number),
                          "--repo", repo, "--body", body])
    if rc != 0:
        raise GitHubError(f"gh pr comment failed (rc={rc}): {err.strip()}")
    return True


def mark_ready(repo: str, number: int) -> bool:
    """`gh pr ready` — flip a draft PR to ready-for-review.

    Required before merging: GitHub rejects ``gh pr merge`` on draft
    PRs with 'Pull Request is still a draft (mergePullRequest)'."""
    rc, out, err = _run(["gh", "pr", "ready", str(number), "--repo", repo])
    if rc != 0:
        msg = err.strip() or out.strip()
        # gh pr ready exits 1 if PR is already ready. Tolerate.
        if "already" in msg.lower() and "ready" in msg.lower():
            return True
        raise GitHubError(f"gh pr ready failed (rc={rc}): {msg}")
    return True


def pr_checks(repo: str, number: int) -> list[dict[str, Any]]:
    """Return the latest CI check rows for a PR via `gh pr checks --json`.

    Each row carries at least ``name``, ``state``, ``bucket``, ``link``;
    we forward whatever gh emits verbatim. Used by ci_poller."""
    rc, out, err = _run(["gh", "pr", "checks", str(number), "--repo", repo,
                          "--json", "name,state,bucket,link,workflow,startedAt,completedAt"])
    if rc != 0:
        raise GitHubError(f"gh pr checks failed (rc={rc}): {err.strip() or out.strip()}")
    try:
        data = json.loads(out) if out.strip() else []
    except json.JSONDecodeError as e:
        raise GitHubError(f"gh pr checks returned non-JSON: {out[:200]}") from e
    return [dict(d) for d in (data or [])]


# ── helpers ─────────────────────────────────────────────────────────


def _extract_pr_number(url: str) -> int:
    """Parse N out of https://github.com/<owner>/<repo>/pull/N."""
    if not url:
        return 0
    parts = url.strip("/").rsplit("/", 1)
    if len(parts) < 2:
        return 0
    try:
        return int(parts[-1])
    except ValueError:
        return 0


def _state_from_view(data: dict[str, Any]) -> str:
    if data.get("mergedAt"):
        return "merged"
    if data.get("isDraft"):
        return "draft"
    state = str(data.get("state") or "").lower()
    if state in ("open", "closed", "merged"):
        return state
    return state or "open"
