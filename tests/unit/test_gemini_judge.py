from __future__ import annotations

import json

import httpx
import pytest

from validator import gemini_judge
from validator.judge_contract import JudgeInput, JudgeError


def _inp() -> JudgeInput:
    return JudgeInput(
        task_id="t", repo_id="r", contract="C", plan=None, worker_done=None,
        diff_summary="D", file_manifest=[], test_results=[], lint_results=[],
        build_results=[], risk_score=None, reviewer_report=None, ci_summary=None,
    )


def test_falls_back_to_mock_when_no_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    r = gemini_judge.judge(_inp())
    assert r.validator == "gemini-mock"
    assert r.verdict in ("PASS", "FAIL", "NEEDS_HUMAN")


def test_calls_gemini_endpoint_with_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "sk-test")
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["body"] = json.loads(request.content.decode())
        payload = {
            "candidates": [{
                "content": {"parts": [{"text": json.dumps({
                    "verdict": "PASS", "confidence": 0.8,
                    "summary": "ok", "blocking_issues": [],
                    "non_blocking_issues": [], "evidence_gaps": [],
                    "recommended_next_action": "merge",
                })}]}
            }]
        }
        return httpx.Response(200, json=payload)

    transport = httpx.MockTransport(handler)
    client = httpx.Client(transport=transport)
    r = gemini_judge.judge(_inp(), client=client)
    assert r.validator == "gemini"
    assert r.verdict == "PASS"
    assert "key=sk-test" in seen["url"]
    assert seen["body"]["generationConfig"]["responseMimeType"] == "application/json"
    # The evidence prompt should be the SOLE user content
    parts = seen["body"]["contents"][0]["parts"]
    assert len(parts) == 1
    assert "CONTRACT" in parts[0]["text"]


def test_raises_on_http_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "x")
    transport = httpx.MockTransport(lambda req: httpx.Response(500, text="boom"))
    client = httpx.Client(transport=transport)
    with pytest.raises(JudgeError):
        gemini_judge.judge(_inp(), client=client)


def test_unwraps_markdown_fenced_json(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "x")
    fenced = "```json\n" + json.dumps({
        "verdict": "FAIL", "confidence": 0.3, "summary": "bad",
        "blocking_issues": ["x"], "non_blocking_issues": [],
        "evidence_gaps": [], "recommended_next_action": "fix",
    }) + "\n```"
    transport = httpx.MockTransport(lambda req: httpx.Response(200, json={
        "candidates": [{"content": {"parts": [{"text": fenced}]}}]
    }))
    client = httpx.Client(transport=transport)
    r = gemini_judge.judge(_inp(), client=client)
    assert r.verdict == "FAIL"
