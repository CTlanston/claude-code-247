from __future__ import annotations

import json

import httpx
import pytest

from validator import openai_judge
from validator.judge_contract import JudgeInput, JudgeError


def _inp() -> JudgeInput:
    return JudgeInput(
        task_id="t", repo_id="r", contract="C", plan=None, worker_done=None,
        diff_summary="D", file_manifest=[], test_results=[], lint_results=[],
        build_results=[], risk_score=None, reviewer_report=None, ci_summary=None,
    )


def test_falls_back_to_mock_when_no_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    r = openai_judge.judge(_inp())
    assert r.validator == "openai-mock"


def test_calls_openai_endpoint_with_bearer(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers.get("authorization")
        seen["url"] = str(request.url)
        seen["body"] = json.loads(request.content.decode())
        payload = {
            "choices": [{"message": {"content": json.dumps({
                "verdict": "PASS", "confidence": 0.95,
                "summary": "ok", "blocking_issues": [],
                "non_blocking_issues": [], "evidence_gaps": [],
                "recommended_next_action": "merge",
            })}}]
        }
        return httpx.Response(200, json=payload)

    transport = httpx.MockTransport(handler)
    client = httpx.Client(transport=transport)
    r = openai_judge.judge(_inp(), client=client, model="gpt-test")
    assert r.validator == "openai"
    assert r.verdict == "PASS"
    assert seen["auth"] == "Bearer sk-test"
    assert seen["url"].endswith("/chat/completions")
    assert seen["body"]["model"] == "gpt-test"
    assert seen["body"]["response_format"] == {"type": "json_object"}


def test_uses_custom_base_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "x")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://custom.example.com/v9")
    seen: dict = {}
    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps({
            "verdict": "PASS", "confidence": 0.5, "summary": "",
            "blocking_issues": [], "non_blocking_issues": [],
            "evidence_gaps": [], "recommended_next_action": "",
        })}}]})
    client = httpx.Client(transport=httpx.MockTransport(handler))
    openai_judge.judge(_inp(), client=client)
    assert seen["url"].startswith("https://custom.example.com/v9/chat/completions")


def test_raises_on_http_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "x")
    transport = httpx.MockTransport(lambda req: httpx.Response(429, text="rate-limit"))
    client = httpx.Client(transport=transport)
    with pytest.raises(JudgeError):
        openai_judge.judge(_inp(), client=client)
