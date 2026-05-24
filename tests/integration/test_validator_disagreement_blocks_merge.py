"""M21-P3 Drill B — validator disagreement blocks auto-merge.

Gemini PASS + OpenAI FAIL/NEEDS_HUMAN must NOT auto-merge. Route to
waiting_for_approval (or blocked, depending on severity).
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest
import yaml

from memory.db import init_db, open_db
from orchestrator.command_queue import enqueue
from orchestrator.dispatcher import run_once
from validator.judge_contract import normalize_response
from validator.validation_policy import ValidationOutcome

from tests.integration.test_sandbox_e2e import (
    SandboxGithub,
    SandboxRunner,
    _flip_writes_on,
    _seed,
)


def _gemini_pass_openai_needs_human(inp):
    gemini = normalize_response("gemini", {
        "verdict": "PASS", "confidence": 1.0, "summary": "looks good",
        "blocking_issues": [], "non_blocking_issues": [],
        "evidence_gaps": [], "recommended_next_action": "merge",
    })
    openai = normalize_response("openai", {
        "verdict": "NEEDS_HUMAN", "confidence": 0.4,
        "summary": "evidence pipeline unclear",
        "blocking_issues": ["unable to verify scope"],
        "non_blocking_issues": [],
        "evidence_gaps": [], "recommended_next_action": "human review",
    })
    return ValidationOutcome(
        ok_for_auto_merge=False, needs_human=True,
        final_verdict="DISAGREE",
        results=[gemini, openai],
        reasons=["validators disagree: [('gemini', 'PASS'), ('openai', 'NEEDS_HUMAN')]"],
    )


def test_validator_disagreement_blocks_automerge(
    fake_repo: Path,
) -> None:
    _seed(fake_repo, auto_merge=True)
    _flip_writes_on()
    runner = SandboxRunner()
    gh = SandboxGithub()

    enqueue("start_task", repo_id="sandbox",
            payload={"repo_id": "sandbox", "goal": "drillB"})
    res = run_once(runner=runner,
                    validator_fn=_gemini_pass_openai_needs_human,
                    github=gh, notify_fn=lambda **_: None,
                    poll_ci=False)

    assert res.handled
    assert res.result["ruling"]["decision"] in ("waiting_approval", "blocked")
    assert gh.merge_calls == [], "gh merge must NOT fire on disagreement"
    # PR is still created so the operator can inspect
    assert gh.create_calls, "PR is still created for human review"
    with open_db() as conn:
        task = conn.execute(
            "SELECT status FROM tasks WHERE id = ?",
            (res.result["task_id"],),
        ).fetchone()
        assert task["status"] == "waiting_for_approval"
        pr = conn.execute(
            "SELECT approval_state FROM prs WHERE repo_id = ?",
            ("sandbox",),
        ).fetchone()
        assert pr["approval_state"] == "required"
