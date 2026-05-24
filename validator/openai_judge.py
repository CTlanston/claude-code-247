"""OpenAI-compatible validator.

REST adapter (no SDK). Uses ``OPENAI_API_KEY`` + the configurable model
in ``config.validators.openai.model``. Falls back to ``mock_judge`` when
the key is missing.

We use the Chat Completions endpoint with ``response_format`` = json_object
because every OpenAI-compatible vendor we care about supports that shape
(OpenAI, Azure OpenAI, OpenRouter, Together, etc.). For self-hosted
endpoints, set ``OPENAI_BASE_URL`` in env.
"""
from __future__ import annotations

import json
import os
from typing import Any

import httpx

from validator import mock_judge
from validator.judge_contract import (
    JudgeError,
    JudgeInput,
    JudgeResult,
    evidence_prompt,
    normalize_response,
)

# M20-P3d: default reduced from `gpt-5` (org-gated) to `gpt-4o` which is
# widely available for org-verified-or-not accounts and supports the
# Chat Completions + response_format json_object shape we rely on. The
# model is overridable via config.validators.openai.model — operators
# with access to newer models can opt up explicitly.
DEFAULT_MODEL = "gpt-4o"
DEFAULT_BASE_URL = "https://api.openai.com/v1"


def judge(
    inp: JudgeInput,
    *,
    model: str = DEFAULT_MODEL,
    api_key: str | None = None,
    base_url: str | None = None,
    timeout_s: float = 60.0,
    client: httpx.Client | None = None,
) -> JudgeResult:
    api_key = api_key or os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return mock_judge.judge(inp, validator_name="openai-mock")
    base_url = (base_url or os.environ.get("OPENAI_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")

    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": "You are a strict evidence-only validator."},
            {"role": "user", "content": evidence_prompt(inp)},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.0,
    }

    own_client = client is None
    client = client or httpx.Client(timeout=timeout_s)
    try:
        resp = client.post(
            f"{base_url}/chat/completions",
            json=body,
            headers={
                "authorization": f"Bearer {api_key}",
                "content-type": "application/json",
            },
        )
    finally:
        if own_client:
            client.close()
    if resp.status_code != 200:
        raise JudgeError(f"openai http {resp.status_code}: {resp.text[:200]}")
    raw = resp.json()

    text = _extract_text(raw)
    payload = _parse_json(text)
    return normalize_response("openai", payload, auth_mode="openai_api")


def _extract_text(raw: dict[str, Any]) -> str:
    choices = raw.get("choices") or []
    if not choices:
        raise JudgeError(f"openai: no choices in response: {raw}")
    msg = choices[0].get("message") or {}
    return str(msg.get("content") or "")


def _parse_json(text: str) -> dict[str, Any]:
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise JudgeError(f"openai returned non-JSON: {text[:200]}") from e
