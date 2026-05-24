"""BR-001 — JudgeInput surfaces diff_body_safe.md to validators.

The validator prompt previously included only the ``diff_summary.md``
(``--stat`` output). With the safe body now collected, ``JudgeInput``
must (a) load it from the evidence directory and (b) include it as a
dedicated section in the evidence prompt, along with the directive
instruction telling the validator how to use it.
"""
from __future__ import annotations

import json
from pathlib import Path

from validator.judge_contract import JudgeInput, evidence_prompt


def _make_evidence(tmp_path: Path, **files: str) -> Path:
    e = tmp_path / ".evidence"
    e.mkdir()
    for name, body in files.items():
        (e / name).write_text(body, encoding="utf-8")
    return e


def test_judge_input_loads_diff_body_safe_when_present(tmp_path: Path) -> None:
    e = _make_evidence(tmp_path, **{"diff_body_safe.md": "# Safe diff\n\n+x = 1\n"})
    inp = JudgeInput.from_evidence_dir(e, task_id="t", repo_id="r")
    assert inp.diff_body_safe is not None
    assert "+x = 1" in inp.diff_body_safe


def test_judge_input_diff_body_safe_missing_is_none(tmp_path: Path) -> None:
    e = _make_evidence(tmp_path)
    inp = JudgeInput.from_evidence_dir(e, task_id="t", repo_id="r")
    assert inp.diff_body_safe is None


def test_judge_input_loads_diff_body_metadata(tmp_path: Path) -> None:
    meta = {
        "task_id": "t",
        "repo_id": "r",
        "files_changed": [{"path": "src/foo.py", "included_in_diff_body": True}],
        "secret_scan": {"status": "PASS", "hits": []},
    }
    e = _make_evidence(
        tmp_path,
        **{"diff_body_safe.md": "+x=1\n",
           "diff_body_metadata.json": json.dumps(meta)},
    )
    inp = JudgeInput.from_evidence_dir(e, task_id="t", repo_id="r")
    assert inp.diff_body_metadata is not None
    assert inp.diff_body_metadata["secret_scan"]["status"] == "PASS"
    assert inp.diff_body_metadata["files_changed"][0]["path"] == "src/foo.py"


def test_evidence_prompt_includes_diff_body_section_when_present(tmp_path: Path) -> None:
    e = _make_evidence(tmp_path, **{"diff_body_safe.md": "# Safe diff\n\n+hello_world_marker\n"})
    inp = JudgeInput.from_evidence_dir(e, task_id="t", repo_id="r")
    p = evidence_prompt(inp)
    assert "## DIFF_BODY" in p
    assert "hello_world_marker" in p


def test_evidence_prompt_instructs_validator_on_diff_body_use(tmp_path: Path) -> None:
    """Directive §Phase 1 — validator prompt must explicitly tell the
    validator to return NEEDS_HUMAN when the diff body is missing or
    insufficient for behavioral judgment, and to not ask for hidden
    conversation context.
    """
    e = _make_evidence(tmp_path, **{"diff_body_safe.md": "+ok\n"})
    inp = JudgeInput.from_evidence_dir(e, task_id="t", repo_id="r")
    p = evidence_prompt(inp)
    # Three semantic markers per directive Phase 1 §Validator instruction:
    assert "diff body" in p.lower()
    assert "NEEDS_HUMAN" in p
    # And we must explicitly tell the validator not to ask for hidden
    # reasoning / conversation context.
    lower = p.lower()
    assert (
        "hidden conversation" in lower
        or "hidden reasoning" in lower
        or "chain-of-thought" in lower
    )


def test_evidence_prompt_omits_diff_body_section_when_missing(tmp_path: Path) -> None:
    """When no safe body exists yet (e.g., pre-M19 evidence), the prompt
    should still render — degrading gracefully rather than inserting a
    confusing empty section."""
    e = _make_evidence(tmp_path)
    inp = JudgeInput.from_evidence_dir(e, task_id="t", repo_id="r")
    p = evidence_prompt(inp)
    # When the body is absent, the DIFF_BODY section can either be absent
    # entirely OR mark itself as "(missing)". What it must NOT do is print
    # the literal string "None" verbatim.
    if "## DIFF_BODY" in p:
        assert "(missing)" in p or "(none)" in p
    assert "None" not in p.split("## DIFF_BODY")[-1] if "## DIFF_BODY" in p else True


def test_evidence_prompt_signals_secret_block_when_metadata_says_blocked(tmp_path: Path) -> None:
    """If diff_body_metadata.json says secret_scan.status == BLOCKED, the
    prompt should reflect that so the validator doesn't pretend the
    redacted body is sufficient."""
    body = (
        "# Safe diff body — REDACTED\n\n"
        "Secret-like content was detected; full body suppressed.\n"
    )
    meta = {
        "task_id": "t", "repo_id": "r",
        "files_changed": [],
        "secret_scan": {"status": "BLOCKED",
                         "hits": [{"pattern": "github_token", "path": "src/foo.py", "line_no": 3}]},
    }
    e = _make_evidence(
        tmp_path,
        **{"diff_body_safe.md": body,
           "diff_body_metadata.json": json.dumps(meta)},
    )
    inp = JudgeInput.from_evidence_dir(e, task_id="t", repo_id="r")
    p = evidence_prompt(inp)
    # Must surface the BLOCKED state somewhere the model will read
    assert "BLOCKED" in p or "REDACTED" in p
