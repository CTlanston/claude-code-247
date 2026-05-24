"""Gemini 2.5 Pro validator.

REST adapter (no SDK) to keep deps small. Uses ``GEMINI_API_KEY``; falls
back to ``validator.mock_judge`` when the key is missing so the system
runs end-to-end without it.

Schema enforcement: we ask Gemini to emit JSON via responseMimeType +
responseSchema. Models still occasionally return invalid JSON, so we
parse with a tolerant fallback.
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

DEFAULT_MODEL = "gemini-2.5-pro"
GEMINI_URL_TPL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


def judge(
    inp: JudgeInput,
    *,
    model: str = DEFAULT_MODEL,
    api_key: str | None = None,
    timeout_s: float = 60.0,
    client: httpx.Client | None = None,
) -> JudgeResult:
    """Call Gemini. When the key is missing, delegate to mock_judge so
    the calling code never has to branch on availability."""
    api_key = api_key or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        # Mark as gemini-mock so the policy layer can tell.
        res = mock_judge.judge(inp, validator_name="gemini-mock")
        return res

    body: dict[str, Any] = {
        "contents": [{"role": "user", "parts": [{"text": evidence_prompt(inp)}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.0,
        },
    }

    own_client = client is None
    client = client or httpx.Client(timeout=timeout_s)
    try:
        resp = client.post(
            GEMINI_URL_TPL.format(model=model),
            params={"key": api_key},
            json=body,
            headers={"content-type": "application/json"},
        )
    finally:
        if own_client:
            client.close()
    if resp.status_code != 200:
        raise JudgeError(f"gemini http {resp.status_code}: {resp.text[:200]}")
    raw = resp.json()

    text = _extract_text(raw)
    payload = _parse_json(text)
    return normalize_response("gemini", payload, auth_mode="gemini_api")


def _extract_text(raw: dict[str, Any]) -> str:
    candidates = raw.get("candidates") or []
    if not candidates:
        raise JudgeError(f"gemini: no candidates in response: {raw}")
    parts = (candidates[0].get("content") or {}).get("parts") or []
    if not parts:
        raise JudgeError(f"gemini: no parts in candidate content: {candidates[0]}")
    return "".join(p.get("text", "") for p in parts)


def _parse_json(text: str) -> dict[str, Any]:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Some models wrap JSON in fenced blocks even when asked not to.
        s = text.strip()
        if s.startswith("```"):
            s = s.strip("`")
            if s.startswith("json"):
                s = s[4:]
            s = s.strip()
        try:
            return json.loads(s)
        except json.JSONDecodeError as e:
            raise JudgeError(f"gemini returned non-JSON: {text[:200]}") from e
