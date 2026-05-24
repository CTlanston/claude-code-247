#!/usr/bin/env bash
set -euo pipefail

# Inputs (env vars):
#   ANTHROPIC_API_KEY
#   CLAUDE_MODEL          claude-sonnet-4-6 / claude-opus-4-7 / ...
#   CLAUDE_ROLE           planner|coder|reviewer|guardian
#   CLAUDE_ALLOWED_TOOLS  e.g. Read,Edit,Write,Bash,Grep,Glob
#   CLAUDE_TOKEN_LIMIT    integer (advisory)
#   CLAUDE_PERMISSION_MODE optional: bypassPermissions|acceptEdits|default
#
# Working dir /workspace is mounted. /system_prompt.md is the role system prompt.
# /workspace/prompt.txt is the user prompt for this turn.

PROMPT_FILE=/workspace/prompt.txt
RESULT_FILE=/workspace/result.json

if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "missing $PROMPT_FILE" >&2
  exit 2
fi

USER_PROMPT="$(cat "$PROMPT_FILE")"
# Role prompts are baked into the image at /system_prompts/<role>.md.
# CLAUDE_ROLE is set by the orchestrator.
SYSTEM_PROMPT_FILE="/system_prompts/${CLAUDE_ROLE:?CLAUDE_ROLE not set}.md"
if [[ ! -f "$SYSTEM_PROMPT_FILE" ]]; then
  echo "missing $SYSTEM_PROMPT_FILE" >&2
  exit 3
fi
SYSTEM_PROMPT="$(cat "$SYSTEM_PROMPT_FILE")"
PERMISSION_MODE="${CLAUDE_PERMISSION_MODE:-bypassPermissions}"

# Verified flags for Claude Code CLI 2.1.x in headless mode:
#   -p / --print              one-shot, no REPL
#   --output-format json      structured output incl. usage + (when API-billed) total_cost_usd
#   --append-system-prompt    role prompt appended to built-in
#   --allowedTools            tool whitelist (camelCase per CLI convention)
#   --model                   model id
#   --permission-mode         bypassPermissions for headless agents
#
# Auth: routed by the orchestrator into the right env var based on token prefix:
#   sk-ant-api03-...  → ANTHROPIC_API_KEY        (api.anthropic.com, BYOK billing)
#   sk-ant-oat01-...  → CLAUDE_CODE_OAUTH_TOKEN  (subscription billing)
# We do NOT use --bare here — it would disable the keychain read path that
# CLAUDE_CODE_OAUTH_TOKEN uses, breaking subscription auth. The other things
# --bare blocked (auto-memory, CLAUDE.md auto-discovery) we mitigate separately:
#   - HOME=/tmp + per-run container = no persistent auto-memory across runs
#   - orchestrator main.py rejects any diff that adds/modifies CLAUDE.md or
#     other agent-config dotfiles before the Reviewer is invoked
#
# Output JSON shape: { result, is_error, [api_error_status], total_cost_usd,
#   usage{input_tokens, output_tokens, cache_*}, session_id, num_turns,
#   duration_ms, stop_reason }.

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

# Normalise CLI output into the shape the orchestrator expects.
# Tolerant: CLI fields may evolve, only pull what we use.
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

# If the model already wrote a structured result.json (per its system prompt), preserve it
# but augment with usage/cost from the CLI envelope when missing.
if out_path.exists():
    try:
        existing = json.loads(out_path.read_text())
    except Exception:
        existing = {}
    existing.setdefault("usage", {
        "input_tokens": int(usage.get("input_tokens", 0)),
        "output_tokens": int(usage.get("output_tokens", 0)),
    })
    if total_cost is not None and "cost_usd" not in existing:
        existing["cost_usd"] = total_cost
    out_path.write_text(json.dumps(existing, ensure_ascii=False, indent=2))
else:
    payload = {
        "raw_text": result_text[:8000],
        "usage": {
            "input_tokens": int(usage.get("input_tokens", 0)),
            "output_tokens": int(usage.get("output_tokens", 0)),
        },
        "summary": result_text.splitlines()[0][:200] if result_text else "",
        "is_error": bool(raw.get("is_error")),
        "api_error_status": raw.get("api_error_status"),
    }
    if total_cost is not None:
        payload["cost_usd"] = total_cost
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
PY

exit $EXIT_CODE
