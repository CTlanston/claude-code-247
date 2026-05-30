#!/usr/bin/env bash
# Patched entrypoint for claude-code-247/runner:e2e1 (derived FROM runner:latest).
#
# Two surgical changes vs the stock /entrypoint.sh, both for E2E-1 hardening:
#  1. Write the RAW Claude CLI envelope verbatim to /workspace/cli-envelope.json
#     BEFORE any normalization, so the host can read authoritative
#     input_tokens / output_tokens / total_cost_usd even when the coder authors
#     its own result.json with usage:0.
#  2. When merging into the coder's result.json, OVERWRITE usage + cost from the
#     CLI envelope (the stock script used setdefault, which left coder-written
#     0/0 token counts in place).
#
# Everything else (auth env routing, claude flags, role/system prompt) is
# identical to the stock entrypoint.
set -euo pipefail

PROMPT_FILE=/workspace/prompt.txt
if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "missing $PROMPT_FILE" >&2
  exit 2
fi

USER_PROMPT="$(cat "$PROMPT_FILE")"
SYSTEM_PROMPT_FILE="/system_prompts/${CLAUDE_ROLE:?CLAUDE_ROLE not set}.md"
if [[ ! -f "$SYSTEM_PROMPT_FILE" ]]; then
  echo "missing $SYSTEM_PROMPT_FILE" >&2
  exit 3
fi
SYSTEM_PROMPT="$(cat "$SYSTEM_PROMPT_FILE")"
PERMISSION_MODE="${CLAUDE_PERMISSION_MODE:-bypassPermissions}"

set +e
claude \
  --print \
  --model "$CLAUDE_MODEL" \
  --append-system-prompt "$SYSTEM_PROMPT" \
  --allowedTools "$CLAUDE_ALLOWED_TOOLS" \
  --output-format json \
  --permission-mode "$PERMISSION_MODE" \
  "$USER_PROMPT" \
  > /tmp/raw.json 2> /tmp/stderr.log
EXIT_CODE=$?
set -e

# (1) Authoritative raw envelope for the host — verbatim, never zeroed.
cp /tmp/raw.json /workspace/cli-envelope.json 2>/dev/null || true

# (2) Normalise into result.json, OVERWRITING usage/cost from the CLI envelope.
python3 - <<'PY'
import json, pathlib

raw_path = pathlib.Path("/tmp/raw.json")
out_path = pathlib.Path("/workspace/result.json")

raw = {}
if raw_path.exists():
    try:
        raw = json.loads(raw_path.read_text())
    except Exception:
        raw = {"raw_text": raw_path.read_text()[:4000]}

usage = raw.get("usage") or raw.get("metrics", {}).get("usage", {}) or {}
result_text = raw.get("result") or raw.get("text") or ""
total_cost = raw.get("total_cost_usd")
cli_usage = {
    "input_tokens": int(usage.get("input_tokens", 0)),
    "output_tokens": int(usage.get("output_tokens", 0)),
}

if out_path.exists():
    try:
        existing = json.loads(out_path.read_text())
    except Exception:
        existing = {}
    # OVERWRITE (not setdefault): the CLI envelope is the source of truth for usage.
    existing["usage"] = cli_usage
    if total_cost is not None:
        existing["cost_usd"] = total_cost
    out_path.write_text(json.dumps(existing, ensure_ascii=False, indent=2))
else:
    payload = {
        "raw_text": result_text[:8000],
        "usage": cli_usage,
        "summary": result_text.splitlines()[0][:200] if result_text else "",
        "is_error": bool(raw.get("is_error")),
        "api_error_status": raw.get("api_error_status"),
    }
    if total_cost is not None:
        payload["cost_usd"] = total_cost
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
PY

exit $EXIT_CODE
