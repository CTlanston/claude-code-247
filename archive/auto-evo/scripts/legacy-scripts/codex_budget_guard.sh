#!/usr/bin/env bash
# codex_budget_guard.sh — wraps every codex invocation with a daily
# token cap + per-call anomaly detector + append-only spend log.
#
# Per L7 §6 Track R + ADR-0008.
#
# Usage:
#   ./scripts/codex_budget_guard.sh exec "prompt"
#   ./scripts/codex_budget_guard.sh review --commit HEAD
#   ./scripts/codex_budget_guard.sh review --uncommitted
#
# Environment overrides:
#   AUTODEV_CODEX_DAILY_CAP   default 200000 tokens (~$1/day at gpt-5.4 input)
#   AUTODEV_CODEX_CALL_CAP    default 60000 tokens per call (anomaly threshold)
#   AUTODEV_CODEX_LOG         default reports/codex-spend.jsonl
#   CODEX_BIN                 default `codex` from PATH (test stub override)
#
# Exit codes:
#   0  call succeeded (or codex's own exit code if codex ran)
#   2  refused: daily cap exceeded BEFORE call
#   N  codex's own exit code if the call ran

set -u

CAP=${AUTODEV_CODEX_DAILY_CAP:-200000}
PER_CALL_CAP=${AUTODEV_CODEX_CALL_CAP:-60000}
LOG=${AUTODEV_CODEX_LOG:-reports/codex-spend.jsonl}
CODEX=${CODEX_BIN:-codex}

mkdir -p "$(dirname "$LOG")"
touch "$LOG"

today=$(date -u +%Y-%m-%d)

# Sum today's tokens from the log. Returns 0 if log empty or no matches.
today_total=$(python3 - "$LOG" "$today" <<'PY'
import json, sys
path, today = sys.argv[1], sys.argv[2]
total = 0
try:
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                continue
            if d.get("date") == today:
                total += int(d.get("tokens", 0) or 0)
except FileNotFoundError:
    pass
print(total)
PY
)
today_total=${today_total:-0}

if [ "$today_total" -ge "$CAP" ]; then
  msg="{\"event\":\"refused\",\"reason\":\"daily_cap_exceeded\",\"date\":\"$today\",\"used\":$today_total,\"cap\":$CAP}"
  echo "$msg" >> "$LOG"
  echo "$msg" >&2
  exit 2
fi

# Run codex, capture output
start_ts=$(date +%s)
output_file=$(mktemp -t codex_out.XXXXXX)
"$CODEX" "$@" > "$output_file" 2>&1
exit_code=$?
end_ts=$(date +%s)

# Parse token count. Codex 0.130 records usage in
# ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl, in an event_msg with
# payload.type=="token_count". We find the freshest session file
# (modified during this call) and read its last token_count entry.
# Fallback: stdout-text regex (for older codex versions or test stubs).
tokens=$(python3 - "$output_file" "$start_ts" <<'PY'
import json, os, re, sys, glob
output_path = sys.argv[1]
call_start = int(sys.argv[2])

# Strategy 1: parse codex session JSONL (canonical for 0.130+)
sessions_root = os.path.expanduser("~/.codex/sessions")
candidates = []
for f in glob.glob(os.path.join(sessions_root, "**", "rollout-*.jsonl"),
                    recursive=True):
    try:
        mtime = os.path.getmtime(f)
    except OSError:
        continue
    if mtime >= call_start - 5:  # within 5s of call start (timezone slack)
        candidates.append((mtime, f))
candidates.sort()  # oldest first; the LAST one is the freshest

session_total = 0
for _mtime, path in candidates:
    try:
        with open(path) as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    d = json.loads(line)
                except json.JSONDecodeError:
                    continue
                payload = d.get("payload") or {}
                if payload.get("type") == "token_count":
                    info = payload.get("info") or {}
                    # total_token_usage is cumulative across this codex session
                    # (one rollout = one `codex` invocation). That's the right
                    # "cost of this one call" metric.
                    tu = info.get("total_token_usage") or {}
                    total = tu.get("total_tokens", 0)
                    if total:
                        session_total = int(total)
    except OSError:
        continue

if session_total > 0:
    print(session_total)
    sys.exit(0)

# Strategy 2: stdout-text regex (legacy / test-stub format)
try:
    with open(output_path) as f:
        text = f.read()
except OSError:
    print(0); sys.exit(0)
m = re.search(r"tokens\s+used\s*\n\s*([\d,]+)", text, re.IGNORECASE)
if m:
    print(int(m.group(1).replace(",", "")))
    sys.exit(0)
m = re.search(r"([\d,]+)\s+tokens(?:\s+used)?", text, re.IGNORECASE)
if m:
    print(int(m.group(1).replace(",", "")))
    sys.exit(0)
m = re.search(r"tokens\s*:\s*([\d,]+)", text, re.IGNORECASE)
if m:
    print(int(m.group(1).replace(",", "")))
    sys.exit(0)
print(0)
PY
)
tokens=${tokens:-0}

anomaly=""
if [ "$tokens" -gt "$PER_CALL_CAP" ]; then
  anomaly="per_call_cap_exceeded"
fi

# JSON-encode args (best effort: handle simple cases)
args_quoted=$(python3 - "$@" <<'PY'
import json, sys
print(json.dumps(" ".join(sys.argv[1:])))
PY
)

duration=$((end_ts - start_ts))
entry=$(python3 - "$today" "$start_ts" "$duration" "$args_quoted" "$tokens" "$exit_code" "$anomaly" <<'PY'
import json, sys
date, ts, dur, args, tokens, ec, anom = sys.argv[1:]
print(json.dumps({
    "date": date,
    "ts": int(ts),
    "duration_s": int(dur),
    "args": json.loads(args),
    "tokens": int(tokens),
    "exit": int(ec),
    "anomaly": anom,
}))
PY
)

echo "$entry" >> "$LOG"

# Surface codex's own output to caller
cat "$output_file"
rm -f "$output_file"

exit "$exit_code"
