"""Scheduling main loop.

Design:
  - Single-threaded outer loop, each issue serialised through four roles.
  - State-machine driven: dispatch by status.
  - Circuit breaker check before every runner spawn.
  - PAUSED file (touched by Guardian or human) freezes dispatch instantly.

For Phase B's MVP, multi-issue concurrency is intentionally deferred (see
DEFERRED.md). When you want it, swap _process_one for ThreadPoolExecutor.submit.
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

import circuit_breaker as cb
import codex_reviewer
import db
import git_proxy
import github_client as gh
import runner

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("orchestrator")

POLL = int(os.getenv("ORCHESTRATOR_POLL_INTERVAL_SECONDS", "30"))
GUARDIAN_MIN = int(os.getenv("GUARDIAN_INTERVAL_MINUTES", "30"))
MAX_REVIEW_ROUNDS = int(os.getenv("PER_ISSUE_MAX_REVIEW_ROUNDS", "3"))
CI_FAILURE_THRESHOLD = int(os.getenv("CI_FAILURE_THRESHOLD_PER_HOUR", "5"))
SHADOW_PREFIX = os.getenv("GITHUB_SHADOW_PREFIX", "shadow")

# Cycle 16 Track R3: cross-model review hooks (ADR-0008)
# `ALERT_PATH` receives disagreement entries; `CODEX_REVIEWS_LOG` is the
# trend-tracking parallel of `codex-spend.jsonl` but with verdict context.
_REPO_ROOT = Path(__file__).resolve().parent.parent
ALERT_PATH = _REPO_ROOT / "ALERT.md"
CODEX_REVIEWS_LOG = _REPO_ROOT / "reports" / "codex-reviews.jsonl"

if os.getenv("STATE_DIR"):
    STATE_DIR = Path(os.environ["STATE_DIR"])
elif os.getenv("LOCAL_MODE", "0") == "1":
    STATE_DIR = Path.home() / ".claude-247-state"
else:
    STATE_DIR = Path("/state")
STATE_DIR.mkdir(parents=True, exist_ok=True)
PAUSED_FLAG = STATE_DIR / "PAUSED"
RATE_LIMITED_FLAG = STATE_DIR / "RATE_LIMITED"  # body = unix ts to resume after
RATE_LIMIT_BACKOFF_MINUTES = int(os.getenv("RATE_LIMIT_BACKOFF_MINUTES", "30"))


# ---------------------------------------------------------------------------
# Ingest
# ---------------------------------------------------------------------------

_GH_ERROR_LOGGED = False


def ingest_issues() -> None:
    global _GH_ERROR_LOGGED
    repo = os.getenv("GITHUB_REPO")
    try:
        issues = gh.list_auto_issues()
    except Exception as e:  # noqa: BLE001
        # GitHub auth/permission errors should surface as one clear log line,
        # not a Python traceback every poll.
        if not _GH_ERROR_LOGGED:
            msg = str(e)
            if "404" in msg:
                hint = (
                    f"GITHUB_REPO={repo!r} returned 404. Likely cause: the "
                    "fine-grained PAT does not have this repo on its access "
                    "list. Visit https://github.com/settings/personal-access-tokens "
                    "→ edit the token → grant 'auto-evo-playground' repo access."
                )
            elif "401" in msg or "Bad credentials" in msg:
                hint = "GITHUB_TOKEN rejected. Re-issue the PAT and update .env."
            else:
                hint = msg
            log.error("[ingest] GitHub query failed: %s", hint)
            _GH_ERROR_LOGGED = True
        return

    _GH_ERROR_LOGGED = False
    for issue in issues:
        if db.get_task(issue.number):
            continue
        log.info("ingesting issue #%s", issue.number)
        db.upsert_task(
            issue.number,
            repo=repo,
            status="queued",
            plan_json=json.dumps({"title": issue.title, "body": issue.body or ""}),
        )


# ---------------------------------------------------------------------------
# State handlers
# ---------------------------------------------------------------------------

_TERMINAL_ANTHROPIC_ERRORS = (
    "Credit balance is too low",
    "Invalid API key",
    "permission_denied",
    "authentication_error",
)

# Subscription quota / API rate-limit responses. Distinct from terminal errors:
# these are recoverable after a backoff window.
_RATELIMIT_PATTERNS = (
    "rate limit",
    "rate_limit",
    "rate-limit",
    "usage limit",
    "quota exceeded",
    "5-hour",
    "5 hour",
    "Please try again",
    "overloaded",  # the model-side overloaded_error is also a retry-after
)


def _result_text(result: dict) -> str:
    return (result.get("raw_text") or result.get("summary") or "")


def _is_terminal_anthropic_error(result: dict) -> Optional[str]:
    """Detect API-side errors that retrying won't fix (billing/auth)."""
    raw = _result_text(result)
    if any(s in raw for s in _TERMINAL_ANTHROPIC_ERRORS):
        return raw[:200]
    return None


def _is_rate_limit_error(result: dict) -> Optional[str]:
    """Detect rate-limit / quota responses. Retryable after backoff."""
    raw = _result_text(result).lower()
    # Don't false-positive on terminal errors that happen to mention "limit".
    if any(s in raw.lower() for s in (s.lower() for s in _TERMINAL_ANTHROPIC_ERRORS)):
        return None
    for pat in _RATELIMIT_PATTERNS:
        if pat.lower() in raw:
            return _result_text(result)[:200]
    # Also catch HTTP 429 surfaced through is_error+api_error_status.
    if result.get("is_error") and result.get("api_error_status") == 429:
        return f"HTTP 429: {_result_text(result)[:200]}"
    return None


def _trip_rate_limit(reason: str) -> None:
    """Pause global dispatch for RATE_LIMIT_BACKOFF_MINUTES minutes."""
    until = int(time.time()) + RATE_LIMIT_BACKOFF_MINUTES * 60
    RATE_LIMITED_FLAG.write_text(str(until))
    log.warning(
        "[ratelimit] tripped: %s — pausing dispatch until %s (%dmin)",
        reason, time.strftime("%H:%M:%S", time.localtime(until)),
        RATE_LIMIT_BACKOFF_MINUTES,
    )
    _slack(
        f":hourglass_flowing_sand: rate limit hit — pausing dispatch "
        f"{RATE_LIMIT_BACKOFF_MINUTES}min. Reason: `{reason[:150]}`"
    )


def _rate_limit_active() -> bool:
    """True if the rate-limit window hasn't expired. Auto-clears the flag
    when the window passes."""
    if not RATE_LIMITED_FLAG.exists():
        return False
    try:
        until = int(RATE_LIMITED_FLAG.read_text().strip())
    except (ValueError, OSError):
        # Malformed flag — treat as expired and clean up.
        RATE_LIMITED_FLAG.unlink(missing_ok=True)
        return False
    if time.time() >= until:
        log.info("[ratelimit] backoff window expired, resuming dispatch")
        RATE_LIMITED_FLAG.unlink(missing_ok=True)
        _slack(":arrow_forward: rate-limit backoff expired, dispatch resumed")
        return False
    return True


def _check_anthropic_response(issue_id: int, role: str, result: dict) -> str:
    """Inspect a runner's result for terminal/rate-limit errors. Returns:
      'ok'        — proceed normally
      'terminal'  — auth/credit issue, pause global dispatch, mark task paused
      'ratelimit' — quota/429, trip rate-limit window, leave task as-is to retry
    """
    rl = _is_rate_limit_error(result)
    if rl:
        _trip_rate_limit(f"[issue {issue_id}/{role}] {rl}")
        return "ratelimit"
    terminal = _is_terminal_anthropic_error(result)
    if terminal:
        log.error("[issue %s/%s] terminal Anthropic error: %s — pausing",
                  issue_id, role, terminal)
        _slack(f":no_entry: terminal Anthropic error on issue #{issue_id}/{role}: `{terminal}`")
        PAUSED_FLAG.touch()
        return "terminal"
    return "ok"


def _do_planning(task: dict) -> None:
    issue_id = task["issue_id"]
    plan_in = json.loads(task["plan_json"] or "{}")

    # V4 Track 2: preflight check BEFORE invoking Planner. Some issues
    # are structurally impossible (e.g. "test reverse() in src/utils.py"
    # when reverse() doesn't exist there AND modifying src/utils.py is
    # forbidden by the issue body). Catching them here avoids burning
    # planner+coder+reviewer cycles on a task that can never succeed.
    try:
        from . import preflight as _preflight
    except ImportError:
        import preflight as _preflight  # type: ignore
    try:
        # Use the orchestrator-cloned worktree as the truth source. If the
        # worktree doesn't exist yet, fall back to the harness root.
        from pathlib import Path
        worktree = Path(os.getenv("WORKSPACE_ROOT", "/workspaces")) / f"issue-{issue_id}" / "repo"
        repo_root = worktree if worktree.exists() else Path(__file__).resolve().parent.parent
        pf = _preflight.preflight_issue(
            title=plan_in.get("title", ""),
            body=plan_in.get("body", ""),
            repo_root=repo_root,
        )
    except Exception as e:  # noqa: BLE001
        # Preflight must never crash the planning path. Log and continue.
        log.warning("[issue %s] preflight raised: %s — continuing without preflight", issue_id, e)
        pf = None
    if pf and not pf.ok:
        log.warning("[issue %s] preflight terminal: %s", issue_id, pf.reason)
        db.upsert_task(
            issue_id, repo=task["repo"],
            status=pf.terminal_status or "failed",
            last_error=pf.reason[:500],
        )
        _slack(f":no_entry_sign: issue #{issue_id} terminal at preflight: {pf.reason[:200]}")
        return

    prompt = (
        f"Issue #{issue_id} 标题: {plan_in.get('title','')}\n\n"
        f"正文:\n{plan_in.get('body','')}\n\n"
        "请按照 system prompt 的格式输出 plan.json"
    )
    out = runner.run_role("planner", issue_id, prompt)
    result = out.get("result") or {}

    status = _check_anthropic_response(issue_id, "planner", result)
    if status == "terminal":
        db.upsert_task(issue_id, repo=task["repo"], status="paused",
                       last_error=_result_text(result)[:200])
        return
    if status == "ratelimit":
        # Leave task in queued; the loop will skip dispatch until the window
        # expires, then re-pick this task naturally.
        return

    if out["exit_code"] != 0 or "steps" not in result:
        db.deduct_credit(issue_id, 30, "planner failed")
        db.upsert_task(issue_id, repo=task["repo"], status="queued",
                       last_error=str(result.get("error") or "planner failed"))
        return
    db.upsert_task(issue_id, repo=task["repo"], status="coding",
                   plan_json=json.dumps(result))


def _do_coding(task: dict) -> None:
    issue_id = task["issue_id"]
    plan = json.loads(task["plan_json"])
    branch = f"{SHADOW_PREFIX}/issue-{issue_id}"

    # Phase B: ensure the worktree exists *before* the runner runs.
    try:
        git_proxy.prepare_worktree(issue_id)
    except Exception as e:  # noqa: BLE001
        log.exception("prepare_worktree failed for issue %s", issue_id)
        db.deduct_credit(issue_id, 20, f"prepare_worktree: {e}")
        db.upsert_task(issue_id, repo=task["repo"], status="queued", last_error=str(e))
        return

    prompt_lines = [
        f"分支已准备好：{branch}",
        "按照 system prompt 的 TDD 规则一步步执行下面的 plan：",
        json.dumps(plan, ensure_ascii=False, indent=2),
    ]

    # If this is a retry (CI failure or Reviewer reject), surface the
    # previous reject reason so the Coder can actually correct course rather
    # than repeating the same mistake. Without this, the loop is non-
    # iterative — Coder always sees the same input and produces the same
    # output. Note: `review_rounds` only increments on REVIEWER rejection,
    # not on CI failure, so we key on `last_error` directly.
    last_error = task.get("last_error")
    rounds = task.get("review_rounds") or 0
    if last_error:
        prompt_lines.extend([
            "",
            f"⚠️ 这是 retry 轮（review_rounds={rounds}）。前一轮被驳回，前一轮反馈如下，",
            "请仔细阅读并 *修复具体问题*，不要重复同样的违规：",
            "",
            "```",
            last_error,
            "```",
            "",
            "请在新的 commit 中修复，不要从头重来。要点：",
            "  - 如果反馈是 CI 失败（lint/test/coverage），逐条修掉里面提到的具体错误；",
            "  - 如果反馈说某文件路径被禁用，绝对不要再改它（pyproject.toml/Dockerfile/.lock/.env/.github/CLAUDE.md 等）；",
            "  - 如果反馈说 TDD 顺序有问题，调整 commit 顺序或删掉 'test:'/'feat:' 错配的旧 commit；",
            "  - 如果反馈说 commit message 不实，让 commit message 真实反映 diff 内容。",
        ])
    out = runner.run_role("coder", issue_id, "\n".join(prompt_lines), plan=plan)
    result = out.get("result") or {}

    status = _check_anthropic_response(issue_id, "coder", result)
    if status == "terminal":
        db.upsert_task(issue_id, repo=task["repo"], status="paused",
                       last_error=_result_text(result)[:200])
        return
    if status == "ratelimit":
        return  # task stays in 'coding'; will retry after backoff

    if out["exit_code"] != 0:
        db.deduct_credit(issue_id, 20, "coder non-zero exit")
        db.upsert_task(issue_id, repo=task["repo"], status="queued", last_error="coder failed")
        return

    # Mirror to GitHub if real-mode (no-op in LOCAL_MODE).
    try:
        git_proxy.mirror_to_github(branch)
    except Exception as e:  # noqa: BLE001
        log.warning("mirror_to_github failed: %s", e)

    db.upsert_task(issue_id, repo=task["repo"], status="ci_running", branch=branch)


def _do_ci_check(task: dict) -> None:
    issue_id = task["issue_id"]
    branch = task["branch"]
    status = gh.latest_workflow_run_status(branch)

    if status is None:
        # No CI signal yet. In LOCAL_MODE we treat absence as auto-pass after
        # a short delay so the demo doesn't stall waiting for nothing.
        if os.getenv("LOCAL_MODE", "0") == "1":
            from github_client import _stub_set_ci
            _stub_set_ci(branch, "success")
            log.info("[local] auto-marking CI green for %s", branch)
            return
        return

    if status == "running":
        return

    if status != "success":
        db.deduct_credit(issue_id, 10, f"ci status={status}")
        # Pull the actual failed-job log so the Coder's retry prompt has
        # something useful to act on. Without this the Coder just sees
        # "ci failure" and tends to make random changes.
        summary = gh.latest_workflow_failure_summary(branch) or f"CI status={status}"
        db.upsert_task(issue_id, repo=task["repo"], status="coding",
                       last_error=summary)
        # Bump the CI failure metric so circuit breaker can trip.
        _bump_ci_metric(success=False)
        return

    _bump_ci_metric(success=True)
    db.upsert_task(issue_id, repo=task["repo"], status="reviewing")


def _do_review(task: dict) -> None:
    issue_id = task["issue_id"]

    # Phase C: hard gates enforced *before* invoking the Reviewer model.
    # Cheap deterministic checks, model can't fudge them — and crucially,
    # they prevent prompt injection of the Reviewer itself (a malicious
    # CLAUDE.md committed by the Coder would otherwise be auto-loaded by
    # Claude Code into the Reviewer's system prompt).
    forbidden = _check_forbidden_paths(issue_id)
    if forbidden:
        log.warning("[issue %s] %s", issue_id, forbidden)
        _maybe_request_changes(task, [{"category": "scope", "msg": forbidden}])
        return
    tdd_violation = _check_tdd_invariant(issue_id)
    if tdd_violation:
        log.warning("[issue %s] TDD invariant violation: %s", issue_id, tdd_violation)
        _maybe_request_changes(task, [{"category": "tdd", "msg": tdd_violation}])
        return

    prompt = (
        f"请审计分支 {task['branch']} 上的全部 commits。"
        f"按 system prompt 的格式输出 verdict.json。"
    )
    out = runner.run_role("reviewer", issue_id, prompt)
    result = out.get("result") or {}

    status = _check_anthropic_response(issue_id, "reviewer", result)
    if status == "terminal":
        db.upsert_task(issue_id, repo=task["repo"], status="paused",
                       last_error=_result_text(result)[:200])
        return
    if status == "ratelimit":
        return  # stays in 'reviewing'; retried after backoff

    verdict = result.get("verdict", "request_changes")
    comments = result.get("comments", [])

    # Cycle 16 Track R3 — cross-model second-opinion via Codex CLI.
    # Codex is enhancement, not dependency: any failure here logs and
    # continues; Claude's verdict remains decisive.
    _maybe_run_codex_review(task, claude_verdict=verdict)

    if verdict == "approve":
        plan = json.loads(task["plan_json"])
        title = plan.get("title", f"Auto: issue #{issue_id}")
        body = (
            f"Auto-generated by Claude Code Agent.\n\n"
            f"Reviewer verdict: **{verdict}**\n"
            f"Summary: {result.get('summary','')}\n\n"
            f"⚠️ This is a Draft PR — human is the only merge approver."
        )
        try:
            pr_no = gh.open_pr(task["branch"], title, body)
            gh.add_pr_label(pr_no, "agent:auto")
            log.info("[issue %s] approved → Draft PR #%s opened", issue_id, pr_no)
        except Exception as e:  # noqa: BLE001
            log.exception("open_pr failed for issue %s", issue_id)
            db.upsert_task(issue_id, repo=task["repo"], status="queued",
                           last_error=f"open_pr: {e}")
            return
        db.upsert_task(issue_id, repo=task["repo"], status="human_review")
        return

    _maybe_request_changes(task, comments)


def _maybe_request_changes(task: dict, comments: list) -> None:
    issue_id = task["issue_id"]
    rounds = (task.get("review_rounds") or 0) + 1
    db.deduct_credit(issue_id, 15, "reviewer request_changes")
    if rounds >= MAX_REVIEW_ROUNDS:
        log.error("[issue %s] hit max review rounds (%s) — labelling agent:human-review",
                  issue_id, MAX_REVIEW_ROUNDS)
        try:
            # Open a Draft PR (if one isn't already there) so the human has a place
            # to land their fixes, then label it for human attention.
            plan = json.loads(task["plan_json"])
            pr_no = gh.open_pr(task["branch"], f"[NEEDS HUMAN] {plan.get('title', task['branch'])}",
                               "Hit max review rounds. Reviewer comments:\n\n" +
                               json.dumps(comments, indent=2, ensure_ascii=False))
            gh.add_pr_label(pr_no, "agent:human-review")
        except Exception as e:  # noqa: BLE001
            log.warning("could not label PR for human review: %s", e)
        db.upsert_task(issue_id, repo=task["repo"], status="human_review",
                       review_rounds=rounds, last_error="max review rounds exceeded")
        return
    db.upsert_task(issue_id, repo=task["repo"], status="coding",
                   review_rounds=rounds,
                   last_error=json.dumps(comments, ensure_ascii=False)[:500])


def _maybe_run_codex_review(task: dict, claude_verdict: str) -> None:
    """Cycle 16 Track R3. Run codex_reviewer.run_codex_review as a
    second-opinion observer. On Claude↔Codex disagreement, append an
    entry to ALERT.md (per L7 §7: NO auto-resolve). Always logs the
    cross-model review to CODEX_REVIEWS_LOG for trend tracking.

    All failures are swallowed — codex is enhancement, not dependency.
    Claude's verdict remains decisive regardless of what codex says.
    """
    issue_id = task.get("issue_id")
    branch = task.get("branch") or ""
    # cycle_id for diagnostics: derive from branch (shadow/issue-N → issue-N)
    cycle_id = (branch.split("/", 1)[-1] if "/" in branch else branch) or f"issue-{issue_id}"
    try:
        # Review the latest commit on the shadow branch
        result = codex_reviewer.run_codex_review(
            base_branch="main", cycle_id=cycle_id,
        )
    except Exception as e:  # noqa: BLE001
        log.warning("[issue %s] codex_reviewer raised; continuing: %s",
                    issue_id, e)
        return

    # Trend-tracking log entry (one line per review attempted)
    try:
        CODEX_REVIEWS_LOG.parent.mkdir(parents=True, exist_ok=True)
        with CODEX_REVIEWS_LOG.open("a") as f:
            import json as _json
            f.write(_json.dumps({
                "issue_id": issue_id,
                "branch": branch,
                "claude_verdict": claude_verdict,
                "codex_verdict": result.verdict,
                "codex_tokens": result.tokens,
                "codex_duration_s": result.duration_s,
                "codex_reason": result.reason or "",
                "n_findings": len(result.findings),
                "disagreement": False,  # set below
            }) + "\n")
    except OSError as e:
        log.warning("could not write %s: %s", CODEX_REVIEWS_LOG, e)

    # Check for cross-model disagreement
    disagreement = codex_reviewer.disagreement_protocol(
        claude_verdict=claude_verdict, codex_verdict=result.verdict,
    )
    if disagreement is None:
        return  # agreement or codex non-signal (skipped/error/unknown)

    # Rewrite the just-written log entry with disagreement=True
    try:
        if CODEX_REVIEWS_LOG.exists():
            lines = CODEX_REVIEWS_LOG.read_text().splitlines()
            if lines:
                import json as _json
                last = _json.loads(lines[-1])
                last["disagreement"] = True
                lines[-1] = _json.dumps(last)
                CODEX_REVIEWS_LOG.write_text("\n".join(lines) + "\n")
    except (OSError, ValueError):
        pass

    log.warning("[issue %s] cross-model disagreement: %s", issue_id, disagreement)
    try:
        codex_reviewer.write_alert(disagreement, ALERT_PATH)
    except OSError as e:
        log.warning("could not write %s: %s", ALERT_PATH, e)


_TEST_COMMIT_RE = re.compile(r"\s*(test|tests|spec|specs|coverage):\s", re.IGNORECASE)
_IMPL_COMMIT_RE = re.compile(r"\s*(feat|fix|impl|implement|refactor):\s", re.IGNORECASE)


def _check_tdd_invariant(issue_id: int) -> Optional[str]:
    """V4 TDD-intent gate (softened from V3's per-step ordering).

    Returns None if the PR passes TDD-INTENT, otherwise a one-line reason.
    Intent passes when BOTH:
      A. at least one test-related commit exists (test/tests/spec/coverage)
      B. at least one of those test commits comes BEFORE at least one
         implementation commit (feat/fix/impl/refactor)

    The V3 rule rejected #14 because an edge-case test was committed
    AFTER the impl. Under the new policy, that's allowed — what matters
    is that the work *started* test-first.
    """
    commits = git_proxy.commit_log(issue_id)
    if not commits:
        return "no commits on shadow branch"
    # commit_log returns newest-first (git log default). For ordering we
    # need oldest-first.
    oldest_first = list(reversed(commits))
    test_positions = [i for i, c in enumerate(oldest_first)
                      if _TEST_COMMIT_RE.match(c["subject"])]
    impl_positions = [i for i, c in enumerate(oldest_first)
                      if _IMPL_COMMIT_RE.match(c["subject"])]
    if not test_positions:
        return "no test/spec commits on shadow branch (TDD-intent FAIL)"
    if not impl_positions:
        return "no feat/fix/impl commits on shadow branch"
    if min(test_positions) > max(impl_positions):
        return ("all test commits land after all implementation commits "
                "(TDD-intent FAIL: tests must precede at least one impl)")
    return None


# Forbidden paths (Coder must never touch). Enforced *before* Reviewer runs so
# the model can't be tricked into approving them via a planted CLAUDE.md.
# CLAUDE.md and `.claude/**` are agent-config files — Claude Code auto-loads
# CLAUDE.md as additional system-prompt context, so a Coder writing one
# can prompt-inject the Reviewer that runs against the same worktree.
_FORBIDDEN_PATH_PATTERNS = (
    re.compile(r"^\.github/"),
    re.compile(r"^Dockerfile($|/)"),
    re.compile(r"^docker-compose\.ya?ml$"),
    re.compile(r".*\.lock$"),
    re.compile(r"^\.env"),
    re.compile(r"^pyproject\.toml$"),
    # Agent-config dotfiles — anti-injection.
    re.compile(r"(^|/)CLAUDE\.md$"),
    re.compile(r"^\.claude/"),
    re.compile(r"^\.cursor"),
    re.compile(r"^\.aider"),
)


def _check_forbidden_paths(issue_id: int) -> Optional[str]:
    """Return None if the diff is clean, else a one-line violation reason.
    Runs before Reviewer is invoked — protects Reviewer from prompt injection
    via planted CLAUDE.md/.claude/* files."""
    files = git_proxy.diff_files(issue_id)
    bad = [f for f in files
           if any(p.match(f) for p in _FORBIDDEN_PATH_PATTERNS)]
    if bad:
        return f"forbidden path(s) modified: {', '.join(bad[:5])}"
    return None


def _bump_ci_metric(success: bool) -> None:
    bucket = int(time.time() // 300)
    with db.conn() as c:
        col = "ci_pass" if success else "ci_fail"
        c.execute(
            f"INSERT INTO metrics (bucket_at, {col}) VALUES (?, 1) "
            f"ON CONFLICT(bucket_at) DO UPDATE SET {col}={col}+1",
            (bucket,),
        )


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

def _process_one(task: dict) -> None:
    try:
        cb.check_issue(task["issue_id"])
    except cb.CircuitOpen as e:
        log.warning("issue %s paused: %s", task["issue_id"], e)
        db.upsert_task(task["issue_id"], repo=task["repo"], status="paused",
                       last_error=str(e))
        return

    handler = {
        "queued": _do_planning,
        "coding": _do_coding,
        "ci_running": _do_ci_check,
        "reviewing": _do_review,
    }.get(task["status"])
    if handler:
        handler(task)


# ---------------------------------------------------------------------------
# Guardian
# ---------------------------------------------------------------------------

def run_guardian() -> None:
    # Subscription mode: CLI sometimes returns non-zero total_cost_usd estimates
    # even under OAuth tokens, and we have a known record_run double-write +
    # stale-state metering bug (tracked in DEFERRED). Both inflate daily_cost_usd
    # into a meaningless number, which the Guardian LLM (correctly) reads as
    # "token spike" and recommends pause. Until the metering bug is fixed at
    # source, force-zero the field under OAuth so Guardian sees the truth: $0.
    _is_subscription = os.environ.get("ANTHROPIC_API_KEY", "").startswith("sk-ant-oat01-")
    _daily_cost = 0.0 if _is_subscription else db.daily_cost_usd()
    metrics = {
        # Under API billing this is real spend; under subscription it's zeroed
        # above to avoid phantom-cost freeze. See block above for rationale.
        "daily_cost_usd": _daily_cost,
        "ci_failures_last_hour": db.ci_failures_last_hour(),
        "rate_limited": RATE_LIMITED_FLAG.exists(),
        "active_tasks": (len(db.list_tasks_by_status("coding"))
                         + len(db.list_tasks_by_status("reviewing"))),
    }
    (STATE_DIR / "metrics.json").write_text(json.dumps(metrics, indent=2))
    # Mount source must be a host-visible path when the orchestrator runs
    # inside a container (compose case). STATE_DIR_HOST is set there.
    state_mount_src = os.getenv("STATE_DIR_HOST", str(STATE_DIR.resolve()))
    out = runner.run_role(
        "guardian",
        issue_id=0,
        user_prompt="读 /state/metrics.json，按 system prompt 输出健康报告。",
        extra_volumes={state_mount_src: {"bind": "/state", "mode": "ro"}},
    )
    result = out.get("result") or {}

    # Guardian itself can also hit terminal/rate-limit errors. Don't loop on it.
    if _check_anthropic_response(0, "guardian", result) != "ok":
        return  # already wrote the right flags / Slack alerts

    rec = result.get("recommendation", "continue")
    db.audit("guardian", "health_check", result)

    if rec in ("pause", "stop"):
        log.error("guardian recommends %s, freezing dispatch", rec)
        PAUSED_FLAG.touch()
        _slack(f":warning: guardian recommends `{rec}`. Dispatch frozen. health={result.get('health')}")
    else:
        # Only the human or guardian-with-continue can clear; we don't auto-clear
        # if the file was created by a human kill-switch. So we only delete when
        # the file *exists and was created by guardian*. Cheap heuristic: only
        # auto-clear inside this function.
        if PAUSED_FLAG.exists() and not (STATE_DIR / "PAUSED.human").exists():
            PAUSED_FLAG.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Slack
# ---------------------------------------------------------------------------

def _slack(text: str) -> None:
    url = os.getenv("SLACK_WEBHOOK_URL", "")
    if not url:
        return
    try:
        import httpx
        httpx.post(url, json={"text": text}, timeout=5)
    except Exception as e:  # noqa: BLE001
        log.warning("slack post failed: %s", e)


# ---------------------------------------------------------------------------
# Entry
# ---------------------------------------------------------------------------

def main() -> None:
    db.init()
    # The orchestrator container runs as root, but worktree directories were
    # created by runner containers that ran as the host user (uid 501).
    # Modern git refuses to operate on dirs owned by a different uid unless
    # they're whitelisted via safe.directory. Whitelist everything under our
    # workspace root — the alternative ('git config --global --add
    # safe.directory <path>' per worktree) is fragile.
    import subprocess
    subprocess.run(["git", "config", "--global", "--add", "safe.directory", "*"],
                   check=False, capture_output=True)
    git_proxy.ensure_remote()
    # Don't fire Guardian immediately on every restart — it'd dominate dev
    # iteration. Treat the start-time as the most recent guardian run, so the
    # first guardian invocation happens GUARDIAN_INTERVAL_MINUTES from now.
    last_guardian = time.time()
    log.info("orchestrator started, polling every %ss (LOCAL_MODE=%s); "
             "next guardian in %dmin",
             POLL, os.getenv("LOCAL_MODE", "0"), GUARDIAN_MIN)

    while True:
        try:
            if PAUSED_FLAG.exists():
                log.warning("dispatch paused (flag=%s)", PAUSED_FLAG)
                time.sleep(POLL)
                continue
            if _rate_limit_active():
                # log every Nth poll only — full message cadence is too chatty
                # over a 30-min window.
                until_ts = int(RATE_LIMITED_FLAG.read_text().strip())
                remaining = max(0, until_ts - int(time.time()))
                log.info("[ratelimit] still backing off, %ds remaining", remaining)
                time.sleep(min(POLL * 4, max(POLL, remaining)))
                continue
            try:
                cb.check_global()
            except cb.CircuitOpen as e:
                log.error("circuit open: %s", e)
                _slack(f":no_entry: circuit open: {e}")
                time.sleep(POLL * 4)
                continue

            ingest_issues()
            for status in ("queued", "coding", "ci_running", "reviewing"):
                for t in db.list_tasks_by_status(status):
                    _process_one(t)

            if time.time() - last_guardian > GUARDIAN_MIN * 60:
                run_guardian()
                last_guardian = time.time()
        except KeyboardInterrupt:
            log.info("interrupted, exiting")
            return
        except Exception:
            log.exception("loop error")

        time.sleep(POLL)


if __name__ == "__main__":
    main()
