"""BR-001 — secret-hit in the safe diff body composes correctly with
the merge policy gate.

The unit-level pieces are exercised individually:
  - EvidenceCollector secret detection: tests/unit/test_evidence_diff_body_safe.py
  - JudgeInput / prompt rendering BLOCKED state: tests/unit/test_validator_receives_diff_body.py
  - merge_policy secret_scanner gate:         tests/unit/test_merge_policy_secret_gate.py

This file proves the **composition**: when the collector finds a
secret, downstream pieces (a) mark metadata BLOCKED, (b) suppress the
real diff in the prompt, AND (c) merge_policy still refuses to
auto-merge — i.e., the validator can never silently un-block a diff
that has secrets in it.
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import yaml

from orchestrator.merge_policy import MergeDecision, decide
from orchestrator.repo_registry import RepoEntry
from orchestrator.risk_score import RiskAssessment
from runner.evidence_collector import EvidenceCollector
from validator.judge_contract import JudgeInput, evidence_prompt, normalize_response
from validator.validation_policy import ValidationOutcome


def _init_repo(workspace: Path) -> None:
    subprocess.run(["git", "init", "-q", "-b", "main", str(workspace)], check=True)


def _commit_initial(workspace: Path, files: dict[str, str]) -> None:
    for rel, content in files.items():
        full = workspace / rel
        full.parent.mkdir(parents=True, exist_ok=True)
        full.write_text(content)
    env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t",
        "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t",
    }
    subprocess.run(["git", "-C", str(workspace), "add", "-A"], check=True)
    subprocess.run(
        ["git", "-C", str(workspace), "commit", "-q", "-m", "init"],
        check=True, env=env,
    )


def _repo() -> RepoEntry:
    return RepoEntry(
        id="demo", name="demo", github_owner="o", github_repo="r",
        local_path="/tmp/x", default_branch="main", enabled=True, risk_level="low",
        raw={"id": "demo",
             "auto_merge": {"enabled": True, "max_risk_score": 30,
                             "max_changed_lines": 300}},
    )


def _all_pass() -> ValidationOutcome:
    r = normalize_response("g", {
        "verdict": "PASS", "confidence": 0.9, "summary": "",
        "blocking_issues": [], "non_blocking_issues": [],
        "evidence_gaps": [], "recommended_next_action": "",
    })
    return ValidationOutcome(
        ok_for_auto_merge=True, needs_human=False,
        final_verdict="PASS", results=[r, r], reasons=["all PASS"],
    )


def _low_risk() -> RiskAssessment:
    return RiskAssessment(score=10, level="low", triggered=[])


def _flip_writes_on() -> None:
    cfg_dir = Path(os.environ["CLAUDE247_CONFIG_DIR"])
    (cfg_dir / "config.yaml").write_text(yaml.safe_dump({
        "system": {"allow_remote_writes": True},
    }))


def test_collector_secret_hit_blocks_metadata_and_redacts_body(tmp_path: Path) -> None:
    """When the collector sees a secret, the on-disk diff body is the
    redacted summary (no secret value), and metadata.secret_scan.status
    is BLOCKED with the offending pattern listed."""
    ws = tmp_path / "ws"
    ws.mkdir()
    _init_repo(ws)
    _commit_initial(ws, {"src/cfg.py": "x = 1\n"})
    (ws / "src" / "cfg.py").write_text(
        "x = 1\nAPI_KEY = 'sk-ant-" + "x" * 40 + "'\n"
    )
    ec = EvidenceCollector(workspace=ws, task_spec={"task_id": "t", "repo_id": "r"})
    diff_path, meta_path = ec.snapshot_diff_body_safe()

    body = diff_path.read_text()
    meta = json.loads(meta_path.read_text())

    # The secret token must NOT appear in the on-disk body
    assert "sk-ant-xxxx" not in body
    # The body announces the redaction
    assert "REDACTED" in body.upper()
    # Metadata locks the BLOCKED verdict
    assert meta["secret_scan"]["status"] == "BLOCKED"
    assert any(h["pattern"] == "anthropic_key" for h in meta["secret_scan"]["hits"])


def test_validator_prompt_surfaces_blocked_state(tmp_path: Path) -> None:
    """When metadata says BLOCKED, the validator prompt must say so up
    front, so a real validator can't be tricked into pretending the
    redacted summary is enough evidence to PASS."""
    ws = tmp_path / "ws"
    ws.mkdir()
    _init_repo(ws)
    _commit_initial(ws, {"src/cfg.py": "x = 1\n"})
    (ws / "src" / "cfg.py").write_text(
        "x = 1\nAPI_KEY = 'sk-ant-" + "x" * 40 + "'\n"
    )
    ec = EvidenceCollector(workspace=ws, task_spec={"task_id": "t", "repo_id": "r"})
    ec.snapshot_diff_body_safe()

    inp = JudgeInput.from_evidence_dir(ws / ".evidence", task_id="t", repo_id="r")
    prompt = evidence_prompt(inp)

    # The DIFF_BODY section must announce BLOCKED state
    assert "BLOCKED" in prompt
    # And the model must be told the merge policy will block regardless
    assert "merge" in prompt.lower()


def test_secret_in_raw_diff_blocks_merge_even_with_pass_validators(tmp_path: Path) -> None:
    """End-to-end composition: even if both validators returned PASS and
    every other gate is green, a secret-bearing raw diff routed to
    merge_policy must come back BLOCKED. This is the existing M16 gate;
    we re-verify it here in the BR-001 chain so a regression that removes
    it would surface against the BR-001 contract too."""
    _flip_writes_on()
    raw_diff = (
        "+API_KEY = 'sk-ant-" + "y" * 40 + "'\n"
        "+def add(a, b):\n+    return a + b\n"
    )
    ruling = decide(
        risk=_low_risk(),
        validators=_all_pass(),
        repo=_repo(),
        ci_passed=True,
        tests_passed=True,
        lint_passed=True,
        diff_content=raw_diff,
    )
    assert ruling.decision == MergeDecision.BLOCKED
    assert any("secret" in r.lower() for r in ruling.reasons)


def test_missing_diff_body_safe_prompt_instructs_needs_human(tmp_path: Path) -> None:
    """Directive §Test case 6 — When the safe diff body is missing, the
    validator prompt must explicitly route the validator to NEEDS_HUMAN.
    A real validator that follows the instruction will then refuse PASS,
    upholding the no-fake-green principle.
    """
    e = tmp_path / ".evidence"
    e.mkdir()
    (e / "contract.md").write_text("# c")  # other evidence present, body absent
    inp = JudgeInput.from_evidence_dir(e, task_id="t", repo_id="r")
    prompt = evidence_prompt(inp)
    assert inp.diff_body_safe is None
    assert "(missing)" in prompt
    # NEEDS_HUMAN must be the suggested verdict
    assert "NEEDS_HUMAN" in prompt
