# Operator Cockpit — Real (non-mock) Smoke Evidence

Date: 2026-06-11T15:23:14.446Z
Result: FAIL — see violations below
Requested mode: strict
Achieved mode: strict
Repo source: sandbox
Validator terminal: (not reached)

## Timeline
- requested mode: strict (strict requires planner=claude-cli + coder=codex-cli; fallback-proof accepts planner=codex-cli (fallback) as DEGRADED)
- repo source: sandbox
- daemon up on http://127.0.0.1:7277; mission repo /tmp/aedev-real-smoke-repo-PFume6; planner cwd /tmp/aedev-real-smoke-repo-PFume6
- session 01KTVMFF53BKW4E382DH79G6B9 created; waiting for live brainstorm…
- brainstorm status: hold

## Violations / failures
- VIOLATION: planner did not reach 95% understanding (status=hold); no execution evidence exists

## Notes
- Live local CLI planner/worker path (no mock/template). Remote writes were disabled.
- Planner ran in an isolated temp git repo; worker ran in an isolated repo-bound git worktree.
- STRICT mode fails on planner fallback; fallback-proof mode labels such runs DEGRADED (planner fallback), never a strict PASS.
- Gemini terminal state is awaited up to 180000ms (AEDEV_COCKPIT_REAL_SMOKE_VALIDATOR_TIMEOUT_MS); a timeout is reported as GEMINI_TIMEOUT, never as vague "pending".
- Strict success requires >=1 executed test command with PASS in the evidence (REGRESSION_EVIDENCE_MISSING otherwise).
- Durable worker evidence (if any) copied alongside this report under operator-cockpit-real-smoke-2026-06-11T15-23-12-230Z-evidence/.