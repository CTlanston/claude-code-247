"""Circuit breaker: decide whether to spawn another runner.

Three checks, all soft-failures that pause dispatch rather than crash:
  1. CI failure rate (>= N/hour)
  2. Per-issue credit (subtractive)
  3. Per-issue retry rounds (Reviewer rejections)

Daily USD budget check was removed when we switched from API key to Claude
subscription auth. Subscription doesn't bill per-USD, so the breaker is
useless. Rate-limit handling now lives in main.py — it writes a
`RATE_LIMITED.until_<ts>` flag that the loop honours like PAUSED.
"""
from __future__ import annotations

import os

import db


class CircuitOpen(Exception):
    """Circuit is open; no new runner this tick."""


def check_global() -> None:
    """Call before any runner spawn. CI-failure-rate is the only global signal
    left after the USD breaker was removed."""
    threshold = int(os.getenv("CI_FAILURE_THRESHOLD_PER_HOUR", "5"))
    fails = db.ci_failures_last_hour()
    if fails >= threshold:
        raise CircuitOpen(f"CI failures in last hour {fails} >= threshold {threshold}")


def check_issue(issue_id: int) -> None:
    task = db.get_task(issue_id)
    if not task:
        return
    if task["credit"] <= 0:
        raise CircuitOpen(f"issue {issue_id} credit exhausted")
    max_rounds = int(os.getenv("PER_ISSUE_MAX_REVIEW_ROUNDS", "3"))
    if (task["review_rounds"] or 0) >= max_rounds:
        raise CircuitOpen(
            f"issue {issue_id} exceeded max review rounds ({max_rounds})"
        )
