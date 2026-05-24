"""M18-P1: OpenAI validator switches to real mode when key is present.

Already covered by existing test_openai_judge.py — this file adds
a focused config-shape regression test."""
from __future__ import annotations

import json
import os

import httpx
import pytest

from validator import openai_judge
from validator.judge_contract import JudgeInput


def _inp() -> JudgeInput:
    return JudgeInput(
        task_id="t", repo_id="r", contract="C", plan=None, worker_done=None,
        diff_summary="D", file_manifest=[], test_results=[], lint_results=[],
        build_results=[], risk_score=None, reviewer_report=None, ci_summary=None,
    )


def test_no_key_returns_openai_mock(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    res = openai_judge.judge(_inp())
    assert res.validator == "openai-mock"
    assert res.auth_mode == "mock"


def test_key_present_returns_real_openai(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    transport = httpx.MockTransport(lambda req: httpx.Response(200, json={
        "choices": [{"message": {"content": json.dumps({
            "verdict": "PASS", "confidence": 0.9, "summary": "ok",
            "blocking_issues": [], "non_blocking_issues": [],
            "evidence_gaps": [], "recommended_next_action": "merge",
        })}}]
    }))
    client = httpx.Client(transport=transport)
    res = openai_judge.judge(_inp(), client=client)
    assert res.validator == "openai"
    assert res.auth_mode == "openai_api"


def test_custom_model_threaded_through(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    captured: dict = {}
    def handler(req):
        captured["body"] = json.loads(req.content.decode())
        return httpx.Response(200, json={
            "choices": [{"message": {"content": json.dumps({
                "verdict": "PASS", "confidence": 0.9, "summary": "",
                "blocking_issues": [], "non_blocking_issues": [],
                "evidence_gaps": [], "recommended_next_action": "",
            })}}]
        })
    client = httpx.Client(transport=httpx.MockTransport(handler))
    openai_judge.judge(_inp(), client=client, model="custom-judge-v2")
    assert captured["body"]["model"] == "custom-judge-v2"
