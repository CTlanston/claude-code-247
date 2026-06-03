# Operator Cockpit — Real (non-mock) Smoke Evidence

Date: 2026-05-31T01:22:43.310Z
Result: PASS (safety invariants held)

## Timeline
- daemon up on http://127.0.0.1:7277; sandbox repo /tmp/claude-501/aedev-real-smoke-repo-t0sBbn
- session 01KSXSW1ESEWEBS68WE6V12R4P created; waiting for live brainstorm…
- brainstorm status: brainstorm_ready
- roadmap generated for mission 01KSXSWK2VCCQXMEW34KSH0AJ3 (live planner JSON parsed)
- roadmap approved; starting live worker…
- worker terminal state: paused
- create-pr → status=blocked code=REMOTE_WRITES_DISABLED
- live providers observed: codex-cli
- validatorStatus=not_configured; evidenceDir=/tmp/claude-501/aedev-real-smoke-state-4jZeE1/operator-evidence/01KSXSXQHY6PYQTAS2SQW2H04G
- evidence files: diff-summary.md, done-report.md, model-usage.json, operator-run.log, plan.md, test-summary.md, transcript-summary.md
- durable evidence copied to /Users/lanston/projects/claude-code-247/evidence/launch/operator-cockpit-real-smoke-2026-05-31T01-20-14-191Z-evidence

## Safety invariants
- All checked: draft PR blocked with REMOTE_WRITES_DISABLED, no PR URL created, validators not faked.

## Notes
- Live local CLI planner/worker path (no mock/template). Remote writes were disabled.
- Planner ran in an isolated temp git repo; worker ran in an isolated temp workspace.
- A planner/worker HOLD is recorded above as honest evidence and does not fail the safety smoke.
- Durable worker evidence (if any) copied alongside this report under operator-cockpit-real-smoke-2026-05-31T01-20-14-191Z-evidence/.