# AutoDev L7 — Cycle 15+ Kickoff (Codex CLI now available)

> Hand this to Claude Code as your single instruction. It supersedes the
> previous "skip Codex" architectural decision because the operator has
> installed and OAuth-authenticated Codex CLI.

Read `/Users/lanston/projects/claude-code-247/AUTODEV_L7_MASTER_PROMPT.md` and `reports/L7-session-wakeup-summary.md` first. Then continue from Cycle 15 per §4 protocol with the following updates.

## Architectural updates from the human (apply immediately)

Codex CLI is installed and OAuth-authenticated:

- Binary: `/Users/lanston/Library/pnpm/nodejs/20.20.2/bin/codex` (v0.130.0)
- Auth path: OAuth via OpenAI account (`codex login`, browser flow completed)
- Default model: `gpt-5.4`
- Sanity call `codex exec "Output exactly: hello"` returned `hello` correctly BUT burned **23,253 tokens** (codex auto-loads repo context every call — the "say hello" prompt wasn't 60 tokens, it was 23K)
- Cost path (ChatGPT subscription-included vs. paid OpenAI API per-token) is **UNCONFIRMED**. Operator has set hard cap $10/month on OpenAI usage dashboard as safety net.

Working `codex` invocations:
- `codex exec "<prompt>"` — non-interactive one-shot
- `codex review --commit <sha>` / `--base <branch>` / `--uncommitted` — diff review (does NOT accept stdin-piped diffs)
- `codex review --help` for full options

**The previous architectural decision "skip Codex indefinitely" is REVOKED**. Track R is now reachable. But it MUST be approached with cost discipline because the per-call token usage is enormous.

---

## Phase 1 — Cost calibration (Cycle 15, MANDATORY before any wider codex use)

This is the entire Cycle 15. Do nothing else.

### 1.1 Build `scripts/codex_budget_guard.sh`

A shell script that wraps every codex invocation:

```bash
#!/usr/bin/env bash
# Usage: ./scripts/codex_budget_guard.sh exec "prompt"
#        ./scripts/codex_budget_guard.sh review --commit HEAD
# Refuses if daily token cap exceeded.

set -u
CAP=${AUTODEV_CODEX_DAILY_CAP:-200000}   # tokens/day, ~$1 at gpt-5.4 rates
PER_CALL_CAP=${AUTODEV_CODEX_CALL_CAP:-60000}
LOG="reports/codex-spend.jsonl"
mkdir -p "$(dirname "$LOG")"

today=$(date -u +%Y-%m-%d)
today_total=$(grep "\"date\":\"$today\"" "$LOG" 2>/dev/null | python3 -c "import sys,json; print(sum(json.loads(l).get('tokens',0) for l in sys.stdin))")
today_total=${today_total:-0}

if (( today_total >= CAP )); then
  echo "{\"event\":\"refused\",\"reason\":\"daily_cap_exceeded\",\"used\":$today_total,\"cap\":$CAP}" >&2
  exit 2
fi

# Run codex, capture token count from stderr (format: "tokens used\n<NUMBER>")
start=$(date +%s)
output=$(codex "$@" 2>&1)
exit_code=$?
end=$(date +%s)

tokens=$(echo "$output" | grep -A1 'tokens used' | tail -1 | tr -d ',')
tokens=${tokens:-0}

# Per-call anomaly check
anomaly=""
if (( tokens > PER_CALL_CAP )); then
  anomaly="per_call_cap_exceeded"
fi

echo "{\"date\":\"$today\",\"ts\":$start,\"duration_s\":$((end-start)),\"args\":\"$*\",\"tokens\":$tokens,\"exit\":$exit_code,\"anomaly\":\"$anomaly\"}" >> "$LOG"

echo "$output"
exit $exit_code
```

Plus regression tests in `tests/test_codex_budget_guard.py` covering:
- A normal call records spend correctly
- A call exceeding daily cap is refused with exit 2
- A call exceeding per-call cap is logged with anomaly flag
- Concurrent call counting is correct (no race in append-only log)

### 1.2 Extend `HUMAN_CONFIG.md` with codex budget fields

```yaml
runtime:
  codex_enabled: true
  codex_daily_cap_tokens: 200000      # ≈ $1/day at gpt-5.4 input rate
  codex_per_call_cap_tokens: 60000
  codex_fallback_on_refusal: true     # fall back to single-Claude review if guard refuses
```

### 1.3 Rewrite `orchestrator/codex_reviewer.py`

The current stub assumes a generic CLI invocation. Update it to:

- Use `bash scripts/codex_budget_guard.sh review --commit <sha>` invocation pattern
- Read HUMAN_CONFIG for caps + fallback flag
- On guard refusal (exit 2): return structured `{"verdict": "skipped", "reason": "budget"}` instead of raising. Cycle continues with single-Claude review.
- On codex failure (exit != 0 and not 2): log to FAILURES if recurring (3+ failures in 24h)
- Parse the codex review output into structured findings:
  ```python
  {
    "source": "codex",
    "model": "gpt-5.4",
    "verdict": "approve|request_changes|reject|skipped",
    "findings": [{"severity": "critical|high|medium|low", "category": "...", "message": "..."}],
    "tokens": int,
    "duration_s": int
  }
  ```

Regression tests in `tests/test_codex_reviewer.py` covering:
- Budget guard refusal returns skipped, doesn't raise
- Successful review returns structured findings
- Unparseable codex output returns verdict="error" with raw output captured
- Concurrent calls don't corrupt the log

### 1.4 First live codex review (cost calibration)

After 1.1–1.3 land + tests green:

1. Find a small recent commit on the harness:
   ```bash
   git log --oneline -10
   # pick one with <50 line diff
   COMMIT=<sha>
   ```
2. Call `bash scripts/codex_budget_guard.sh review --commit $COMMIT` ONCE.
3. Read `reports/codex-spend.jsonl` last line. Capture:
   - Token count
   - Wall duration
   - Exit code
   - Whether anomaly flag fired

4. Estimated cost at gpt-5.4 input rates (~$0.005/1K, output ~$0.015/1K):
   ```python
   cost_usd = (tokens * 0.005) / 1000     # if mostly input (typical for review)
   ```
5. Write `reports/codex-cost-calibration.md` with:
   - Token count from the test
   - Estimated USD cost per review
   - Projected daily cost at N reviews/day (use N=10)
   - Whether this exceeds the daily cap
   - Verdict: GO / NO-GO for wider codex use

**DECISION GATE**: if estimated per-review cost > $0.50, OR if 10/day projected cost > $5, write `BLOCKED.md` with:
- The observed cost
- The estimated daily cost
- Three options for the human (lower cap / accept cost / find alternative)
- STOP and exit. Do NOT proceed to Phase 2 without human authorization.

If cost is acceptable (< $0.50/review, < $5/day): write the GO verdict to calibration report and continue.

### 1.5 Write ADR-0008

```markdown
# ADR-0008: Codex CLI permitted for cross-model review within daily token budget

## Context
The §0.1 hard constraint forbids paid Anthropic API calls. Codex CLI (OpenAI)
is a different vendor. The operator has explicitly installed Codex, OAuth-
authenticated it, set a $10/month OpenAI hard cap, and authorized its use
for Track R cross-model review subject to a tighter in-system daily cap.

## Decision
Codex CLI calls are permitted from `orchestrator/codex_reviewer.py` only when
they pass through `scripts/codex_budget_guard.sh` and remain under
`HUMAN_CONFIG.runtime.codex_daily_cap_tokens` (default 200,000 tokens/day,
≈ $1/day at gpt-5.4 input rates).

Single-Claude review remains the fallback for all cases where the budget
guard refuses or codex fails. The cycle is never blocked by codex
unavailability.

## Consequences
+ R dim can advance from L3 (no cross-model bridge) to L4 (CLI on PATH) and
  L5 (actual review running).
+ Each cycle has a measurable codex cost trail in `reports/codex-spend.jsonl`.
+ Discipline is enforced by software, not by self-control.
+ Documented carve-out from the original §0.1 zero-paid-API stance.

- Adds OpenAI as an external dependency. If OpenAI rate-limits or breaks,
  cycles continue but R dim usage drops back to single-Claude.
- Token cost is real and visible to the operator monthly.

## Alternatives rejected
1. Use a local Ollama Llama-3 8B as adversarial reviewer (free, but
   significantly lower review quality). Deferred to a future ADR.
2. Use a second isolated Claude Code session as adversarial reviewer
   (free under subscription, but doesn't truly cross models). Considered for
   the case where Codex usage hits the cap.

## Linked regression tests
- `tests/test_codex_budget_guard.py`
- `tests/test_codex_reviewer.py`

## Linked cycle
Cycle 15
```

### 1.6 Cycle 15 acceptance

Before EXIT:
- [ ] `scripts/codex_budget_guard.sh` exists + executable + tested
- [ ] `tests/test_codex_budget_guard.py` green (≥4 tests)
- [ ] `HUMAN_CONFIG.md` has new codex fields
- [ ] `orchestrator/codex_reviewer.py` updated to use guard + structured output
- [ ] `tests/test_codex_reviewer.py` green
- [ ] One real codex review call logged in `reports/codex-spend.jsonl`
- [ ] `reports/codex-cost-calibration.md` written with verdict GO/NO-GO
- [ ] `docs/adr/0008-codex-cli-budgeted-review.md` written
- [ ] `compute_level.py` rerun; R should be at L4 (CLI on PATH) at minimum
- [ ] CHANGELOG, STATE, BACKLOG, LEVEL all updated per §4 step 9

If NO-GO from calibration: BLOCKED.md written, exit cleanly, R stays L3.

---

## Phase 2 — After Cycle 15 GO verdict: parallel track progression

If Phase 1 calibration passes, the next 10-15 cycles work the priority list below. `compute_level.py` and BACKLOG pick the exact next track each cycle.

### Track priorities (cheapest-level-up first per §3 rubric)

| Order | Track | Goal | Estimated cycles | Currently blocks |
|-------|-------|------|------------------|------------------|
| 1 | R3 | Wire codex_reviewer.py into `_process_one` Reviewer step; observe codex+Claude disagreement | 1-2 | R → L5 |
| 2 | C2 | Convert orchestrator to git worktrees; `worktrees/stream-1/`, `stream-2/`; `scripts/spawn_worktree.sh` | 2-3 | C → L4 |
| 3 | T5-option3 | Homegrown mutator on `billable.py` (~95 lines), achieve ≥80% kill rate | 1-2 | T → L5 |
| 4 | C3 | `scheduler.py` dispatching across worktrees; per-worktree STATE.md | 2-3 | C → L5 path |
| 5 | R4 | Adversarial reviewer subagent (single-purpose: find production failure modes) | 1-2 | R → L6 |
| 6 | C4-5 | 30-cycle deadlock-free observation period at 2-3 streams | 30+ | C → L5 (final) |

Track R3 first because it's cheap (1-2 cycles), it actually exercises the budget guard you just built (proves it works), and it lifts the lowest dim. C is next because it's the OTHER L3 floor.

### Cycle 16–25 acceptance per §4

Each cycle:
- One dim advances by one increment OR explicit FAIL with FAILURES.md entry
- All §0 hard constraints respected
- 45-min wall clock cap
- Atomic commit on `autoevo/<cycle-id>/...` branch
- CHANGELOG entry, STATE update, LEVEL recompute
- `reports/codex-spend.jsonl` daily total must remain under cap

### Milestone-2 after 10 successful cycles (=Cycle 24 or 25)

Per §18: write `reports/milestone-2.md`:
- Codex spend month-to-date (running total of `codex-spend.jsonl`)
- Average tokens per codex review
- Disagreement rate between Claude reviewer and Codex reviewer (signal quality)
- Each dim's level progression since Cycle 14 baseline
- Top 3 patterns observed
- Honest assessment: did this rubric move correlate with actual system quality, or just paperwork?

---

## Hard constraints (re-stated for emphasis)

All §0 constraints from `AUTODEV_L7_MASTER_PROMPT.md` apply unchanged, with this single carve-out documented in ADR-0008:

- §0.1 Anthropic API: STILL forbidden
- §0.5 third-party paid services: Codex CLI permitted within budget guard only
- All other §0 rules unchanged

You may NOT:
- Bypass the budget guard "just for this one call"
- Increase `codex_daily_cap_tokens` mid-cycle to make a call fit
- Skip writing to `reports/codex-spend.jsonl`
- Make codex calls outside `orchestrator/codex_reviewer.py` or `scripts/codex_budget_guard.sh`
- Suggest the operator raise the OpenAI $10/month hard cap

If you encounter a case where codex is unavailable, broken, or refused-by-budget: fall back to single-Claude review, log the fallback, continue the cycle. Codex is enhancement, not dependency.

---

## Failure handling

| Condition | Behavior |
|-----------|----------|
| Codex returns HTTP 401 | Auth expired. Log to FAILURES. Don't retry. Fall back to single-Claude review. Write ALERT.md asking operator to re-run `codex login`. |
| Codex returns HTTP 429 (rate limit) | Log to FAILURES. Sleep 5 min. Retry once. If still 429, fall back single-Claude. |
| Codex output unparseable | Log full output to `cycles/<id>/codex-raw.log`. Return verdict="error". Cycle continues. |
| `codex` binary not on PATH (regression) | R drops L4→L3. Log to FAILURES. Don't fail the cycle (R loss isn't a regression in other dims). |
| `reports/codex-spend.jsonl` corrupted | Don't auto-truncate. Write BLOCKED.md with the corruption details. Human must inspect. |
| Per-call cap exceeded | Don't refuse the call (it's already complete). Log the anomaly. If 3+ anomalies in 24h, write ALERT.md. |

---

## Tone & discipline (per §16)

You are not creative. You are a maintenance-grade engineer building cost-aware
infrastructure one small verified step at a time. Track R progress is valuable
ONLY if it doesn't bankrupt the operator. Discipline > speed.

The system that survives 200 disciplined codex-budgeted cycles beats the
system that did 5 brilliant unbudgeted ones and got the operator a $200
OpenAI bill.

---

## Begin

Begin Cycle 15 now per Phase 1 above. Do not narrate the directive back. Do not ask for permission. Make every cycle count.
